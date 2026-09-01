import { pickClosestHour, fetchWorkoutWeather } from "@/lib/weather/open-meteo";

const sample = {
  hourly: {
    time: ["2026-01-15T06:00", "2026-01-15T07:00", "2026-01-15T08:00"],
    temperature_2m: [10, 12, 14],
    apparent_temperature: [9, 11, 13],
    dew_point_2m: [4, 4.5, 5],
    relative_humidity_2m: [80, 75, 70],
    wind_speed_10m: [2.5, 3, 3.5],
    wind_direction_10m: [180, 190, 200],
    weather_code: [1, 2, 3],
  },
};

describe("pickClosestHour", () => {
  it("selects the hour closest to the workout start", () => {
    const w = pickClosestHour(sample, new Date("2026-01-15T07:20:00Z"));
    expect(w?.tempC).toBe(12);
    expect(w?.windSpeedMs).toBe(3);
    expect(w?.weatherCode).toBe(2);
  });

  it("clamps to the last hour when past the range", () => {
    const w = pickClosestHour(sample, new Date("2026-01-15T23:00:00Z"));
    expect(w?.tempC).toBe(14);
  });

  it("returns null when the response has no rows", () => {
    const empty = {
      hourly: {
        time: [],
        temperature_2m: [],
        apparent_temperature: [],
        dew_point_2m: [],
        relative_humidity_2m: [],
        wind_speed_10m: [],
        wind_direction_10m: [],
        weather_code: [],
      },
    };
    expect(pickClosestHour(empty, new Date())).toBeNull();
  });
});

describe("fetchWorkoutWeather", () => {
  it("requests °C + m/s and parses the closest hour", async () => {
    const fetchMock = jest.fn(async (url: URL | RequestInfo) => {
      const u = String(url);
      expect(u).toContain("wind_speed_unit=ms");
      expect(u).toContain("start_date=2026-01-15");
      return { ok: true, status: 200, json: async () => sample } as unknown as Response;
    }) as unknown as typeof fetch;
    const w = await fetchWorkoutWeather(19.43, -99.13, new Date("2026-01-15T06:10:00Z"), fetchMock);
    expect(w?.tempC).toBe(10);
  });

  it("returns null on HTTP errors", async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const w = await fetchWorkoutWeather(0, 0, new Date(), fetchMock);
    expect(w).toBeNull();
  });

  it("uses the archive API for old dates", async () => {
    const fetchMock = jest.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain("archive-api.open-meteo.com");
      return { ok: true, status: 200, json: async () => sample } as unknown as Response;
    }) as unknown as typeof fetch;
    await fetchWorkoutWeather(0, 0, new Date("2020-06-01T12:00:00Z"), fetchMock);
    expect(fetchMock).toHaveBeenCalled();
  });
});
