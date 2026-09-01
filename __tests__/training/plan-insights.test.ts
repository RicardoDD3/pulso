import {
  computeRaceReadiness,
  computeRaceCountdown,
  computeWeeklyScorecard,
  computeProgressRings,
  getTodayISO,
} from "@/lib/training/plan-insights";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
} from "@/lib/training/plan-generator-types";

/** Shift an ISO date (YYYY-MM-DD) by n days, staying in UTC to avoid TZ drift. */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function day(date: string, over: Partial<GeneratedDay> = {}): GeneratedDay {
  return {
    date,
    dayOfWeek: 0,
    dayLabel: "Lun",
    sessionType: "z2",
    distanceKm: 0,
    zone: "Z2",
    notes: "",
    isKeySession: false,
    ...over,
  };
}

function week(over: Partial<GeneratedWeek>): GeneratedWeek {
  return {
    weekNumber: 1,
    phase: "base",
    mesoWeek: 1,
    weekStartDate: "2026-01-05",
    totalKm: 0,
    z2Km: 0,
    longRunPlusB2bKm: 0,
    days: [],
    strengthSessions: 0,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
    ...over,
  };
}

function plan(over: Partial<GeneratedPlan>): GeneratedPlan {
  return {
    raceDistanceKm: 42,
    raceDate: "2026-12-31",
    planWeeks: 1,
    peakWeeklyKm: 100,
    currentWeeklyKm: 30,
    startDate: "2026-01-05",
    weeks: [],
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: {
      exercises: [],
      basePhaseFrequency: "",
      buildPeakFrequency: "",
      taperFrequency: "",
    },
    ...over,
  } as GeneratedPlan;
}

/**
 * Regression: computeRaceReadiness.overallScore is a 0–100 percentage and must
 * never exceed 100, even when the athlete over-completes planned volume.
 *
 * Bug (found 2026-07-20 bug hunt): volumePct was not capped before being
 * weighted into `overall` (its sibling computeProgressRings caps volume), so
 * running more than planned pushed the readiness score above 100.
 */
describe("computeRaceReadiness — overallScore cap (regression)", () => {
  it("clamps overallScore to <= 100 when actual volume exceeds planned", () => {
    const today = getTodayISO();
    const p = plan({
      raceDistanceKm: 10,
      weeks: [
        week({
          weekStartDate: today,
          totalKm: 250,
          days: [day(today, { sessionType: "z2", distanceKm: 250 })],
        }),
      ],
    });
    const matched = [
      {
        workout: {
          date: today,
          status: "completed",
          actual_distance_km: 280, // over-completed vs 250 planned -> volumePct 112
        },
        activity: null,
      },
    ] as never;
    const runs = [
      { date: today, activity_type: "running", distance_meters: 10000, duration_seconds: 3600 },
    ] as never;

    const result = computeRaceReadiness(p, matched, runs, [], []);

    expect(result.volumePct).toBeGreaterThan(100); // raw compliance can exceed 100
    expect(result.overallScore).toBeLessThanOrEqual(100); // the score cannot
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Regression: a day with strength ALSO has a "strength" row in
 * training_plan_workouts sharing the same date as the run row. The insights
 * built their date→match Map over ALL rows, so the strength row (status
 * "planned", actual null) overwrote the completed run of the day and the UI
 * showed 0 km / 0 sesiones / no checkmark even with the run synced in the DB
 * (reported by Jorge, week 22 of plan 11, 2026-07-27).
 */
describe("insights ignore strength rows sharing the run's date (regression)", () => {
  const today = getTodayISO();

  const runWorkout = {
    id: 1,
    date: today,
    workout_type: "easy_run",
    status: "completed",
    actual_distance_km: 13,
  };
  const strengthWorkout = {
    id: 2,
    date: today,
    workout_type: "strength",
    status: "planned",
    actual_distance_km: null,
  };
  // Same order the API returns them: run first, strength last (last wins in a Map)
  const matched = [
    { workout: runWorkout, activity: null },
    { workout: strengthWorkout, activity: null },
  ] as never;

  const currentWeek = week({
    weekNumber: 22,
    weekStartDate: today,
    totalKm: 12.7,
    days: [day(today, { distanceKm: 12.7 })],
  });

  it("computeWeeklyScorecard counts the completed run despite the strength row", () => {
    const sc = computeWeeklyScorecard(currentWeek, matched);

    expect(sc).not.toBeNull();
    expect(sc!.days[0].isCompleted).toBe(true);
    expect(sc!.completedSessions).toBe(1);
    expect(sc!.totalActualKm).toBe(13);
  });

  it("computeProgressRings counts the day as consistent", () => {
    const p = plan({ weeks: [currentWeek] });
    const rings = computeProgressRings(p, matched, []);

    expect(rings.consistency).toBe(100);
  });

  it("computeRaceReadiness counts the day as consistent", () => {
    const p = plan({ weeks: [currentWeek] });
    const result = computeRaceReadiness(p, matched, [], [], []);

    expect(result.consistencyPct).toBe(100);
  });
});

/**
 * Regression: computeRaceCountdown must report the FIRST week (not the final
 * race week) when the plan has not started yet.
 *
 * Bug (found 2026-07-20 bug hunt): getCurrentWeekIndex returns -1 both before a
 * plan starts and after it ends; the code collapsed both cases to
 * currentWeek = planWeeks / phase = "race", mislabeling a not-yet-started plan
 * as being in its final race week.
 */
describe("computeRaceCountdown — before the plan starts (regression)", () => {
  it("reports week 1 / first phase for a plan entirely in the future", () => {
    const today = getTodayISO();
    const w1Start = addDaysISO(today, 7); // plan starts a week from now
    const w2Start = addDaysISO(today, 14);
    const p = plan({
      planWeeks: 2,
      raceDate: addDaysISO(today, 21),
      weeks: [
        week({
          weekNumber: 1,
          phase: "base",
          weekStartDate: w1Start,
          days: [day(w1Start), day(addDaysISO(w1Start, 6))],
        }),
        week({
          weekNumber: 2,
          phase: "race",
          weekStartDate: w2Start,
          days: [day(w2Start), day(addDaysISO(w2Start, 6))],
        }),
      ],
    });

    const result = computeRaceCountdown(p, [], []);

    expect(result.currentWeek).toBe(1);
    expect(result.phase).toBe("base");
    expect(result.totalWeeks).toBe(2);
  });
});
