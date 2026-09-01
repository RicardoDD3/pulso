// Formateo puro del clima de una actividad (activity_weather). Garmin guarda las
// temperaturas en °F y los rumbos de viento en inglés (w = oeste); aquí se
// convierten a °C y a español. Todo input→output, null-safe.

import { toNum } from "./activity-detail";

/**
 * NOTA (Pulso): el almacenamiento canónico de temperatura ahora es °C — la
 * ingesta convierte °F→°C al escribir, en vez de convertir al renderizar como
 * hacía el origen. `fToC` y `formatWeather` se conservan tal cual para filas
 * legadas en °F y fuentes que sigan reportando °F; no aplicar la conversión
 * dos veces sobre datos ya almacenados en °C.
 */
export const TEMPERATURE_STORAGE_NOTE =
  "Canonical storage is °C; fToC is for legacy/ingest-time conversion of Garmin °F values only.";

/** °F → °C, o null si no hay temperatura. */
export function fToC(f: unknown): number | null {
  const v = toNum(f);
  return v === null ? null : ((v - 32) * 5) / 9;
}

export const WEATHER_TYPE_ES: Record<string, string> = {
  CLEAR: "Despejado",
  "MOSTLY CLEAR": "Mayormente despejado",
  FAIR: "Despejado",
  "PARTLY CLOUDY": "Parcialmente nublado",
  "MOSTLY CLOUDY": "Mayormente nublado",
  CLOUDY: "Nublado",
  RAIN: "Lluvia",
  "LIGHT RAIN": "Lluvia ligera",
  DRIZZLE: "Llovizna",
  MIST: "Neblina",
  FOG: "Niebla",
  HAZE: "Bruma",
  THUNDERSTORM: "Tormenta",
  SNOW: "Nieve",
};

export function weatherTypeEs(t: unknown): string | null {
  if (t === null || t === undefined || t === "") return null;
  const key = String(t).toUpperCase();
  return WEATHER_TYPE_ES[key] || String(t);
}

/** Rumbo de viento inglés → español (W → O). "wnw" → "ONO". */
export function windCompassEs(compass: unknown): string | null {
  if (compass === null || compass === undefined || compass === "") return null;
  return String(compass)
    .toUpperCase()
    .split("")
    .map((c) => (c === "W" ? "O" : c))
    .join("");
}

export interface RawWeather {
  temp?: number | string | null;
  apparent_temp?: number | string | null;
  dew_point?: number | string | null;
  relative_humidity?: number | string | null;
  wind_speed?: number | string | null;
  wind_direction_compass?: string | null;
  weather_type?: string | null;
  weather_station?: string | null;
}

export interface FormattedWeather {
  tempC: number | null;
  apparentC: number | null;
  dewPointC: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windCompass: string | null;
  typeEs: string | null;
  station: string | null;
}

export function formatWeather(row: RawWeather | null | undefined): FormattedWeather | null {
  if (!row) return null;
  return {
    tempC: fToC(row.temp),
    apparentC: fToC(row.apparent_temp),
    dewPointC: fToC(row.dew_point),
    humidity: toNum(row.relative_humidity),
    windSpeed: toNum(row.wind_speed),
    windCompass: windCompassEs(row.wind_direction_compass),
    typeEs: weatherTypeEs(row.weather_type),
    station: row.weather_station || null,
  };
}
