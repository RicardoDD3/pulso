import { mergeHealthDay } from "@/lib/health/merge";
import type { HealthDayRow } from "@/lib/db/schema";

function row(provider: string, fields: Partial<HealthDayRow>): HealthDayRow {
  return {
    id: 1,
    userId: "u1",
    date: "2026-01-15",
    provider,
    steps: null,
    floors: null,
    intensityMinutes: null,
    distanceM: null,
    caloriesTotal: null,
    caloriesActive: null,
    restingHr: null,
    hrMin: null,
    hrMax: null,
    stressAvg: null,
    stressMax: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    spo2Avg: null,
    respirationAvg: null,
    hrvMs: null,
    hrvStatus: null,
    hydrationMl: null,
    raw: null,
    ...fields,
  };
}

describe("mergeHealthDay", () => {
  it("returns null with no rows", () => {
    expect(mergeHealthDay([], "garmin")).toBeNull();
  });

  it("primary provider wins field by field", () => {
    const merged = mergeHealthDay(
      [row("oura", { restingHr: 48, hrvMs: 55 }), row("garmin", { restingHr: 52, steps: 9000 })],
      "garmin",
    );
    expect(merged?.restingHr).toBe(52); // garmin primary wins
    expect(merged?.steps).toBe(9000);
    expect(merged?.hrvMs).toBe(55); // oura fills the NULL
  });

  it("secondary providers fill NULLs deterministically (alphabetical)", () => {
    const merged = mergeHealthDay(
      [row("whoop", { hrvMs: 80 }), row("oura", { hrvMs: 60 })],
      "garmin", // primary not present
    );
    // oura < whoop alphabetically → oura fills first
    expect(merged?.hrvMs).toBe(60);
  });

  it("lists only contributing providers", () => {
    const merged = mergeHealthDay(
      [row("garmin", { steps: 5000 }), row("oura", {})],
      "garmin",
    );
    expect(merged?.providers).toEqual(["garmin"]);
  });

  it("single provider without primary set works", () => {
    const merged = mergeHealthDay([row("oura", { restingHr: 47 })], null);
    expect(merged?.restingHr).toBe(47);
    expect(merged?.providers).toEqual(["oura"]);
  });
});
