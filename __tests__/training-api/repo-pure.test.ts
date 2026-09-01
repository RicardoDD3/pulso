/**
 * Pure parts of lib/db/repos/training.ts — the normalization invariant every
 * plan_json read/write passes through, the unpack row builders and the
 * versionsToPrune wiring. No DB required.
 */
import {
  normalizePlanJson,
  planWorkoutSeedsFromGeneratedPlan,
  planWorkoutSeedsFromPlanData,
  versionIdsToPrune,
  KEEP_VERSIONS,
} from "@/lib/db/repos/training";
import type {
  GeneratedDay,
  GeneratedPlan,
  GeneratedWeek,
  SessionType,
} from "@/lib/training/plan-generator-types";
import type { PlanData } from "@/lib/training/types";

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function makeDay(
  date: string,
  dayOfWeek: number,
  sessionType: SessionType,
  distanceKm: number,
  extra: Partial<GeneratedDay> = {},
): GeneratedDay {
  return {
    date,
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek],
    sessionType,
    distanceKm,
    zone: sessionType === "rest" ? "" : "Z2",
    notes: "",
    isKeySession: false,
    ...extra,
  };
}

/** Week fixture with a legacy strength day, an unlocked rest and a locked rest. */
function makeFixturePlan(): GeneratedPlan {
  const days: GeneratedDay[] = [
    makeDay("2026-08-31", 0, "z2", 10),
    makeDay("2026-09-01", 1, "hiit", 8),
    makeDay("2026-09-02", 2, "strength", 5), // legacy: strength as sessionType
    makeDay("2026-09-03", 3, "rest", 0), // unlocked rest → must become z2
    makeDay("2026-09-04", 4, "z2", 12),
    makeDay("2026-09-05", 5, "long_run", 20),
    makeDay("2026-09-06", 6, "rest", 0, { restLocked: true }), // stays rest
  ];
  const week: GeneratedWeek = {
    weekNumber: 1,
    phase: "base",
    mesoWeek: 1,
    weekStartDate: "2026-08-31",
    totalKm: 55,
    z2Km: 22,
    longRunPlusB2bKm: 20,
    days,
    strengthSessions: 0,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
  };
  return {
    raceDistanceKm: 100,
    raceDate: "2027-01-30",
    planWeeks: 1,
    peakWeeklyKm: 55,
    currentWeeklyKm: 50,
    startDate: "2026-08-31",
    weeks: [week],
    nutritionGuide: { title: "", phases: [], raceDayPlan: [], keyPrinciples: [] },
    strengthProgram: { title: "", frequency: "", duration: "", exercises: [], notes: [] },
  } as unknown as GeneratedPlan;
}

describe("normalizePlanJson (the read/write invariant)", () => {
  it("migrates legacy strength days and removes unlocked rest days", () => {
    const plan = makeFixturePlan();
    const changed = normalizePlanJson(plan);
    expect(changed).toBe(true);

    const days = plan.weeks[0].days;
    // Legacy strength day → strengthDay flag, no strength sessionType left.
    expect(days[2].sessionType).not.toBe("strength");
    expect(days[2].strengthDay).toBe(true);
    expect(plan.weeks[0].strengthSessions).toBe(1);
    // Unlocked rest converted to z2; locked rest untouched.
    expect(days[3].sessionType).toBe("z2");
    expect(days[6].sessionType).toBe("rest");
    expect(days[6].restLocked).toBe(true);
    // No day besides the locked one may remain rest.
    expect(days.filter((d) => d.sessionType === "rest")).toHaveLength(1);
  });

  it("is idempotent: a second pass reports no change (write→read stability)", () => {
    const plan = makeFixturePlan();
    normalizePlanJson(plan); // the write path
    const snapshot = JSON.parse(JSON.stringify(plan));
    expect(normalizePlanJson(plan)).toBe(false); // the read path
    expect(plan).toEqual(snapshot);
  });

  it("leaves LLM-format plans (weeks[].workouts[]) untouched", () => {
    const llmPlan = { weeks: [{ week_number: 1, workouts: [] }] };
    const before = JSON.parse(JSON.stringify(llmPlan));
    expect(normalizePlanJson(llmPlan)).toBe(false);
    expect(llmPlan).toEqual(before);
  });
});

describe("plan workout unpack", () => {
  it("GeneratedPlan → one row per non-rest day plus strength-flag rows; extras never make rows", () => {
    const plan = makeFixturePlan();
    plan.weeks[0].days[0].extraSessions = [
      { id: "x1", sessionType: "z2", distanceKm: 4, origin: "planner" },
    ];
    normalizePlanJson(plan);
    const seeds = planWorkoutSeedsFromGeneratedPlan(plan);

    // 6 run days (locked rest excluded) + 1 strength flag row.
    expect(seeds.filter((s) => s.workoutType !== "strength")).toHaveLength(6);
    expect(seeds.filter((s) => s.workoutType === "strength")).toHaveLength(1);
    expect(seeds.find((s) => s.date === "2026-09-06")).toBeUndefined();
    // The extra session added no row for its day.
    expect(seeds.filter((s) => s.date === "2026-08-31")).toHaveLength(1);
    // Type mapping.
    expect(seeds.find((s) => s.date === "2026-09-01")?.workoutType).toBe("intervals");
    expect(seeds.find((s) => s.date === "2026-09-05")?.workoutType).toBe("long_run");
  });

  it("PlanData (LLM format) → one row per workout with its targets", () => {
    const planData = {
      summary: { total_weeks: 1, peak_weekly_km: 40, phases: [] },
      pace_targets: { easy: "6:00", tempo: "5:00", interval: "4:30", long_run: "6:15", race: "5:30" },
      hr_zones: [],
      nutrition_flags: [],
      weeks: [
        {
          week_number: 1,
          phase: "base",
          target_km: 40,
          notes: "",
          workouts: [
            {
              day_of_week: 0,
              date: "2026-09-07",
              workout_type: "easy_run",
              title: "Easy",
              description: "",
              target_distance_km: 8,
              target_duration_min: null,
              target_pace_range: "5:45-6:15",
              target_hr_zone: "Z2",
              intervals_detail: null,
              strength_exercises: null,
            },
          ],
        },
      ],
    } as unknown as PlanData;
    expect(planWorkoutSeedsFromPlanData(planData)).toEqual([
      {
        weekNumber: 1,
        dayOfWeek: 0,
        date: "2026-09-07",
        workoutType: "easy_run",
        title: "Easy",
        targetDistanceKm: 8,
        targetPaceRange: "5:45-6:15",
        targetHrZone: "Z2",
      },
    ]);
  });
});

describe("versionIdsToPrune (versionsToPrune wiring over uuid rows)", () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({
    id: `v-${i}`,
    createdAt: new Date(Date.UTC(2026, 0, i + 1)),
  }));

  it("keeps the KEEP_VERSIONS newest and returns the oldest ids", () => {
    expect(KEEP_VERSIONS).toBe(10);
    const prune = versionIdsToPrune(rows);
    expect(prune.sort()).toEqual(["v-0", "v-1", "v-2"]);
  });

  it("returns nothing at or below the keep threshold", () => {
    expect(versionIdsToPrune(rows.slice(0, 10))).toEqual([]);
    expect(versionIdsToPrune([])).toEqual([]);
  });
});
