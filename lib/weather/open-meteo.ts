/**
 * Per-workout weather via Open-Meteo (spec doc 03): free, no API key,
 * historical archive included. Canonical units: °C, m/s. Stored ONCE at
 * ingestion — no render-time conversions (the original stored Garmin °F).
 */
import { z } from "zod";

const responseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    apparent_temperature: z.array(z.number().nullable()),
    dew_point_2m: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    wind_speed_10m: z.array(z.number().nullable()),
    wind_direction_10m: z.array(z.number().nullable()),
    weather_code: z.array(z.number().nullable()),
  }),
});

export type WorkoutWeather = {
  tempC: number | null;
  apparentTempC: number | null;
  dewPointC: number | null;
  relativeHumidity: number | null;
  windSpeedMs: number | null;
  windDirectionDeg: number | null;
  weatherCode: number | null;
};

/** Pure: pick the hourly row closest to `at` from a parsed response. */
export function pickClosestHour(
  data: z.infer<typeof responseSchema>,
  at: Date,
): WorkoutWeather | null {
  const { hourly } = data;
  if (hourly.time.length === 0) return null;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const diff = Math.abs(Date.parse(`${hourly.time[i]}:00Z`) - at.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return {
    tempC: hourly.temperature_2m[best] ?? null,
    apparentTempC: hourly.apparent_temperature[best] ?? null,
    dewPointC: hourly.dew_point_2m[best] ?? null,
    relativeHumidity: hourly.relative_humidity_2m[best] ?? null,
    windSpeedMs: hourly.wind_speed_10m[best] ?? null,
    windDirectionDeg: hourly.wind_direction_10m[best] ?? null,
    weatherCode: hourly.weather_code[best] ?? null,
  };
}

const HOURLY_FIELDS =
  "temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code";

/**
 * Fetch weather for a workout start. Recent dates use the forecast API
 * (past_days); older ones the historical archive.
 */
export async function fetchWorkoutWeather(
  lat: number,
  lng: number,
  at: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkoutWeather | null> {
  const date = at.toISOString().slice(0, 10);
  const ageDays = (Date.now() - at.getTime()) / 86_400_000;
  const base =
    ageDays > 80
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";
  const url = new URL(base);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("hourly", HOURLY_FIELDS);
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const parsed = responseSchema.safeParse(await res.json());
  if (!parsed.success) return null;
  return pickClosestHour(parsed.data, at);
}
