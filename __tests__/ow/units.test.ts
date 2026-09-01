import {
  fahrenheitToCelsius,
  gramsToKg,
  kmhToMps,
  kmToMeters,
  litersToMl,
  milesToMeters,
  minutesToSeconds,
  paceSecPerKmToMps,
  poundsToKg,
  secondsToMinutes,
} from "@/lib/health/units";

describe("lib/health/units", () => {
  it("converts fahrenheit to celsius", () => {
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
    expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 5);
    expect(fahrenheitToCelsius(-40)).toBe(-40);
  });

  it("converts miles to meters", () => {
    expect(milesToMeters(1)).toBe(1609.344);
    expect(milesToMeters(0)).toBe(0);
    expect(milesToMeters(3.1)).toBeCloseTo(4988.9664, 4);
  });

  it("converts kilometers to meters", () => {
    expect(kmToMeters(5)).toBe(5000);
    expect(kmToMeters(0.5)).toBe(500);
  });

  it("converts minutes to seconds and back", () => {
    expect(minutesToSeconds(90)).toBe(5400);
    expect(secondsToMinutes(27000)).toBe(450);
    expect(secondsToMinutes(minutesToSeconds(7.5))).toBe(7.5);
  });

  it("converts grams and pounds to kg", () => {
    expect(gramsToKg(72500)).toBe(72.5);
    expect(poundsToKg(160)).toBeCloseTo(72.5747792, 6);
    expect(poundsToKg(0)).toBe(0);
  });

  it("converts liters to ml", () => {
    expect(litersToMl(1.5)).toBe(1500);
  });

  it("converts km/h to m/s", () => {
    expect(kmhToMps(36)).toBe(10);
  });

  it("converts pace (sec/km) to speed (m/s)", () => {
    expect(paceSecPerKmToMps(300)).toBeCloseTo(3.3333, 4); // 5:00/km
    expect(paceSecPerKmToMps(250)).toBe(4); // 4:10/km
    expect(paceSecPerKmToMps(0)).toBe(0);
    expect(paceSecPerKmToMps(-10)).toBe(0);
  });
});
