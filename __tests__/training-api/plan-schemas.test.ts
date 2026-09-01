import {
  PlanPatchSchema,
  PlanPatchesSchema,
  PlanDataSchema,
  PlannerActionSchema,
  validatePlannerActions,
} from "@/lib/training/plan-schemas";
import type { PlannerAction } from "@/lib/training/planner-intent";

describe("PlanPatchSchema", () => {
  it("accepts a valid patch", () => {
    const patch = {
      week: 3,
      day: 2,
      sessionType: "z2",
      distanceKm: 12,
      zone: "Z2",
      notes: "suave",
      isKeySession: false,
      strengthDay: true,
      extraSessions: [{ sessionType: "hiit", distanceKm: 5, origin: "planner" }],
    };
    expect(PlanPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("rejects an invalid sessionType and out-of-range day", () => {
    expect(PlanPatchSchema.safeParse({ week: 1, day: 0, sessionType: "swim" }).success).toBe(false);
    expect(PlanPatchSchema.safeParse({ week: 1, day: 7 }).success).toBe(false);
    expect(PlanPatchSchema.safeParse({ week: 0, day: 0 }).success).toBe(false);
  });

  it("strips unknown keys instead of failing (LLM noise tolerance)", () => {
    const parsed = PlanPatchSchema.parse({ week: 1, day: 1, distanceKm: 8, reason: "porque sí" });
    expect(parsed).toEqual({ week: 1, day: 1, distanceKm: 8 });
  });
});

describe("PlanPatchesSchema", () => {
  it("accepts both the bare array and the {changes} wrapper", () => {
    const arr = [{ week: 1, day: 0, distanceKm: 10 }];
    expect(PlanPatchesSchema.parse(arr)).toEqual(arr);
    expect(PlanPatchesSchema.parse({ changes: arr })).toEqual(arr);
  });

  it("rejects an empty change list and non-arrays", () => {
    expect(PlanPatchesSchema.safeParse([]).success).toBe(false);
    expect(PlanPatchesSchema.safeParse({ week: 1, day: 0 }).success).toBe(false);
  });
});

describe("PlanDataSchema", () => {
  const valid = {
    summary: { total_weeks: 2, peak_weekly_km: 60, phases: [] },
    pace_targets: { easy: "6:00", tempo: "5:00", interval: "4:30", long_run: "6:15", race: "5:30" },
    hr_zones: [{ zone: "Z2", bpm_range: [120, 140] }],
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
            target_pace_range: null,
            target_hr_zone: "Z2",
            intervals_detail: null,
            strength_exercises: null,
          },
        ],
      },
    ],
  };

  it("accepts a valid PlanData", () => {
    expect(PlanDataSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a plan without weeks or with a malformed workout date", () => {
    expect(PlanDataSchema.safeParse({ ...valid, weeks: [] }).success).toBe(false);
    const bad = JSON.parse(JSON.stringify(valid)) as typeof valid;
    bad.weeks[0].workouts[0].date = "07/09/2026";
    expect(PlanDataSchema.safeParse(bad).success).toBe(false);
  });
});

describe("planner action allowlist", () => {
  it("accepts every allowlisted action shape", () => {
    const actions = [
      { action: "answer" },
      { action: "modify_plan", instruction: "sube el long run" },
      { action: "rename_plan", name: "UTMB 2027" },
      {
        action: "log_workout",
        workout: { title: "Gym", workout_type: "strength", duration_minutes: 45 },
      },
      { action: "log_exercise", exercise: { kind: "weighted", exercise: "press_banca", weight_kg: 60, reps: 8 } },
      { action: "log_exercise", exercise: { kind: "bodyweight", exercise: "lagartijas", reps: 30 } },
      { action: "edit_exercises", ops: [{ op: "add", type: "weighted", label: "Hip Thrust" }] },
      { action: "set_steps_goal", min: 180000, max: null },
      { action: "undo" },
    ];
    for (const a of actions) expect(PlannerActionSchema.safeParse(a).success).toBe(true);
  });

  it("rejects unknown actions and malformed inputs", () => {
    expect(PlannerActionSchema.safeParse({ action: "delete_all_data" }).success).toBe(false);
    expect(PlannerActionSchema.safeParse({ action: "modify_plan" }).success).toBe(false);
    expect(
      PlannerActionSchema.safeParse({
        action: "log_workout",
        workout: { title: "x", workout_type: "swimming" },
      }).success,
    ).toBe(false);
    expect(
      PlannerActionSchema.safeParse({
        action: "log_exercise",
        exercise: { kind: "weighted", exercise: "press", reps: 8 },
      }).success,
    ).toBe(false);
  });

  it("validatePlannerActions turns anything invalid into answer (never executes)", () => {
    const routed = [
      { action: "modify_plan", instruction: "cambia el miércoles a 10 km" },
      { action: "drop_tables" },
      { action: "set_steps_goal", min: null, max: null },
    ] as unknown as PlannerAction[];
    const validated = validatePlannerActions(routed);
    expect(validated).toEqual([
      { action: "modify_plan", instruction: "cambia el miércoles a 10 km" },
      { action: "answer" },
      { action: "answer" },
    ]);
  });
});
