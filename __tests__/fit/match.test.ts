import { matchWorkout, MATCH_WINDOW_MS } from "@/lib/fit/match";
import type { ParsedFit } from "@/lib/fit/parse";
import type { WorkoutRow } from "@/lib/db/schema";

const T0 = Date.parse("2026-08-30T13:00:00Z");

function parsedAt(offsetMs: number, distanceM: number | null = 10_000): ParsedFit {
  return {
    session: {
      startTime: new Date(T0 + offsetMs),
      sport: "running",
      totalDistanceM: distanceM,
      totalElapsedS: null,
      totalTimerS: null,
      hrAvg: null,
      hrMax: null,
      totalAscentM: null,
      totalDescentM: null,
      aerobicTe: null,
      anaerobicTe: null,
      trainingLoad: null,
      speedAvgMps: null,
      speedMaxMps: null,
      calories: null,
      startLat: null,
      startLng: null,
    },
    laps: [],
    routePoints: [],
    hrZones: [],
  };
}

function workout(offsetMs: number, distanceM: number | null = 10_000): WorkoutRow {
  return {
    id: crypto.randomUUID(),
    startAt: new Date(T0 + offsetMs),
    distanceM,
  } as WorkoutRow;
}

describe("matchWorkout", () => {
  it("matches a workout starting within ±5 minutes", () => {
    const w = workout(4 * 60_000);
    expect(matchWorkout(parsedAt(0), [w])).toBe(w);
    const earlier = workout(-4 * 60_000);
    expect(matchWorkout(parsedAt(0), [earlier])).toBe(earlier);
  });

  it("rejects workouts outside the ±5 minute window", () => {
    expect(matchWorkout(parsedAt(0), [workout(MATCH_WINDOW_MS + 1)])).toBeNull();
    expect(matchWorkout(parsedAt(0), [workout(-(MATCH_WINDOW_MS + 1))])).toBeNull();
  });

  it("accepts exactly the window boundary", () => {
    const w = workout(MATCH_WINDOW_MS);
    expect(matchWorkout(parsedAt(0), [w])).toBe(w);
  });

  it("rejects a distance mismatch beyond 10%", () => {
    expect(matchWorkout(parsedAt(0, 10_000), [workout(0, 8_900)])).toBeNull();
    expect(matchWorkout(parsedAt(0, 8_900), [workout(0, 10_000)])).toBeNull();
  });

  it("accepts distances within 10%", () => {
    const w = workout(0, 9_100);
    expect(matchWorkout(parsedAt(0, 10_000), [w])).toBe(w);
  });

  it("matches by time alone when either side lacks distance", () => {
    const noDist = workout(60_000, null);
    expect(matchWorkout(parsedAt(0, 10_000), [noDist])).toBe(noDist);
    const w = workout(60_000, 10_000);
    expect(matchWorkout(parsedAt(0, null), [w])).toBe(w);
  });

  it("breaks ties by nearest start", () => {
    const near = workout(60_000);
    const far = workout(-3 * 60_000);
    expect(matchWorkout(parsedAt(0), [far, near])).toBe(near);
    expect(matchWorkout(parsedAt(0), [near, far])).toBe(near);
  });

  it("returns null with no session or start time", () => {
    const parsed = parsedAt(0);
    parsed.session = null;
    expect(matchWorkout(parsed, [workout(0)])).toBeNull();
    const noStart = parsedAt(0);
    noStart.session!.startTime = null;
    expect(matchWorkout(noStart, [workout(0)])).toBeNull();
  });

  it("returns null for empty candidates", () => {
    expect(matchWorkout(parsedAt(0), [])).toBeNull();
  });
});
