import { toTrainingActivity, stableActivityRef } from "@/lib/training/adapter";
import type { WorkoutRow } from "@/lib/db/schema";

/** Fila canónica completa con defaults razonables; override por caso. */
function makeWorkout(overrides: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    userId: "11111111-2222-3333-4444-555555555555",
    provider: "garmin",
    externalId: "1234567890",
    sport: "running",
    name: "Morning Run",
    startAt: new Date("2026-08-31T06:30:00.000Z"),
    durationS: 3600,
    movingS: 3550,
    distanceM: 10000,
    calories: 700,
    hrAvg: 145,
    hrMax: 172,
    hrMin: 90,
    elevationGainM: 120,
    elevationLossM: 118,
    cadenceAvg: 170,
    speedAvgMps: 2.78,
    speedMaxMps: 4.1,
    powerAvgW: null,
    powerMaxW: null,
    aerobicTe: 3.2,
    anaerobicTe: 0.5,
    trainingLoad: 110,
    teLabel: null,
    gapMps: null,
    vo2max: 52,
    detailSource: null,
    raw: null,
    ...overrides,
  };
}

describe("toTrainingActivity", () => {
  it("mapea todos los campos que consume la lógica portada (happy path)", () => {
    const w = makeWorkout();
    const a = toTrainingActivity(w);

    expect(a).toEqual({
      activity_id: stableActivityRef(w.id),
      date: "2026-08-31",
      activity_type: "running",
      distance_meters: 10000,
      duration_seconds: 3600,
      avg_hr: 145,
      max_hr: 172,
      vo2max_value: 52,
      avg_speed: 2.78,
    });
  });

  it("propaga null en los campos de FC cuando el workout no trae FC (p.ej. Oura)", () => {
    const a = toTrainingActivity(makeWorkout({ hrAvg: null, hrMax: null, vo2max: null }));

    expect(a.avg_hr).toBeNull();
    expect(a.max_hr).toBeNull();
    expect(a.vo2max_value).toBeNull();
    // El resto del shape sigue completo.
    expect(a.distance_meters).toBe(10000);
    expect(a.duration_seconds).toBe(3600);
  });

  it("deriva una ref numérica estable y positiva del uuid", () => {
    const w = makeWorkout();
    const a1 = toTrainingActivity(w);
    const a2 = toTrainingActivity(makeWorkout());
    const other = toTrainingActivity(
      makeWorkout({ id: "00000000-0000-0000-0000-000000000001" })
    );

    expect(a1.activity_id).toBe(a2.activity_id); // determinística
    expect(a1.activity_id).not.toBe(other.activity_id);
    expect(Number.isInteger(a1.activity_id)).toBe(true);
    expect(a1.activity_id).toBeGreaterThan(0);
  });
});
