import {
  fToC,
  weatherTypeEs,
  windCompassEs,
  formatWeather,
} from "@/lib/health/weather";

describe("fToC", () => {
  it("converts Fahrenheit to Celsius", () => {
    expect(fToC(57)).toBeCloseTo(13.89, 2);
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBe(100);
  });
  it("coerces string temps and returns null when missing", () => {
    expect(fToC("50")).toBeCloseTo(10);
    expect(fToC(null)).toBeNull();
    expect(fToC("")).toBeNull();
  });
});

describe("weatherTypeEs", () => {
  it("maps known types (case-insensitive)", () => {
    expect(weatherTypeEs("Cloudy")).toBe("Nublado");
    expect(weatherTypeEs("Mostly Cloudy")).toBe("Mayormente nublado");
    expect(weatherTypeEs("Fair")).toBe("Despejado");
    expect(weatherTypeEs("Thunderstorm")).toBe("Tormenta");
  });
  it("passes through unknown types and nulls empty", () => {
    expect(weatherTypeEs("Sleet")).toBe("Sleet");
    expect(weatherTypeEs("")).toBeNull();
    expect(weatherTypeEs(null)).toBeNull();
  });
});

describe("windCompassEs", () => {
  it("translates west to O and keeps other letters", () => {
    expect(windCompassEs("e")).toBe("E");
    expect(windCompassEs("wnw")).toBe("ONO");
    expect(windCompassEs("sw")).toBe("SO");
    expect(windCompassEs("n")).toBe("N");
  });
  it("returns null when absent", () => {
    expect(windCompassEs("")).toBeNull();
    expect(windCompassEs(null)).toBeNull();
  });
});

describe("formatWeather", () => {
  it("formats a full weather row into °C + Spanish", () => {
    const w = formatWeather({
      temp: 57,
      apparent_temp: 57,
      dew_point: 50,
      relative_humidity: 77,
      wind_speed: 4,
      wind_direction_compass: "e",
      weather_type: "Cloudy",
      weather_station: "MEXICO CITY",
    });
    expect(w).not.toBeNull();
    expect(w!.tempC).toBeCloseTo(13.89, 2);
    expect(w!.humidity).toBe(77);
    expect(w!.windCompass).toBe("E");
    expect(w!.typeEs).toBe("Nublado");
    expect(w!.station).toBe("MEXICO CITY");
  });
  it("returns null for a missing row and null fields degrade gracefully", () => {
    expect(formatWeather(null)).toBeNull();
    const w = formatWeather({ temp: null, weather_type: null });
    expect(w!.tempC).toBeNull();
    expect(w!.typeEs).toBeNull();
  });
});
