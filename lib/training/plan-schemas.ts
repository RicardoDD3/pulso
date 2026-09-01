/**
 * Zod schemas for everything an LLM can hand the Training API (spec docs 09/11).
 *
 * The original trusted the model's shape and validated ad hoc at apply time;
 * here every LLM payload is validated BEFORE it touches a plan or the DB:
 * - PlanPatchesSchema — /modify and the planner's modify_plan patches.
 * - PlanDataSchema — AI plan generation output (weeks[].workouts[]).
 * - PlannerActionSchema — the planner chat's action allowlist (discriminated
 *   union); anything outside it is answered, never executed.
 *
 * NEW file (not a ported module): the ported lib/training/* stays untouched.
 */
import { z } from "zod";
import type { PlannerAction } from "@/lib/training/planner-intent";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* Plan patches (modify flow)                                          */
/* ------------------------------------------------------------------ */

/** Extra sessions the LLM may write back (replaceDayExtras re-validates). */
const extraSessionPatchSchema = z.object({
  id: z.string().max(120).optional(),
  sessionType: z.enum(["z2", "hiit", "long_run", "back_to_back"]),
  distanceKm: z.number().positive().max(400),
  origin: z.enum(["carryover", "manual", "planner", "moved"]).optional(),
  carryoverFrom: z.string().regex(ISO_DATE).optional(),
  movedFrom: z.string().regex(ISO_DATE).optional(),
  isKeySession: z.boolean().optional(),
});

/** One day-change from the modify LLM (PlanPatch of plan-modifier.ts). */
export const PlanPatchSchema = z.object({
  week: z.number().int().min(1).max(120),
  day: z.number().int().min(0).max(6),
  sessionType: z.enum(["z2", "hiit", "long_run", "back_to_back", "rest"]).optional(),
  distanceKm: z.number().min(0).max(400).optional(),
  zone: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
  isKeySession: z.boolean().optional(),
  strengthDay: z.boolean().optional(),
  extraSessions: z.array(extraSessionPatchSchema).max(10).optional(),
});

export type PlanPatch = z.infer<typeof PlanPatchSchema>;

/** The model may answer `[...]` or `{ "changes": [...] }` — both accepted. */
export const PlanPatchesSchema = z
  .union([
    z.array(PlanPatchSchema).min(1).max(300),
    z.object({ changes: z.array(PlanPatchSchema).min(1).max(300) }),
  ])
  .transform((v) => (Array.isArray(v) ? v : v.changes));

/* ------------------------------------------------------------------ */
/* AI-generated plan (PlanData of lib/training/types)                  */
/* ------------------------------------------------------------------ */

const plannedWorkoutSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  date: z.string().regex(ISO_DATE),
  workout_type: z.string().min(1).max(40),
  title: z.string().max(200).default(""),
  description: z.string().max(2000).default(""),
  target_distance_km: z.number().min(0).max(400).nullable().default(null),
  target_duration_min: z.number().min(0).max(3000).nullable().default(null),
  target_pace_range: z.string().max(40).nullable().default(null),
  target_hr_zone: z.string().max(20).nullable().default(null),
  intervals_detail: z
    .array(
      z.object({
        reps: z.number(),
        distance_m: z.number(),
        pace: z.string().max(40),
        rest: z.string().max(40),
      }),
    )
    .nullable()
    .default(null),
  strength_exercises: z
    .array(z.object({ name: z.string().max(120), sets: z.number(), reps: z.number() }))
    .nullable()
    .default(null),
});

export const PlanDataSchema = z.object({
  summary: z.object({
    total_weeks: z.number().int().min(1).max(120),
    peak_weekly_km: z.number().min(0).max(500),
    phases: z
      .array(
        z.object({
          name: z.string().max(60),
          weeks: z.tuple([z.number(), z.number()]),
          focus: z.string().max(300),
        }),
      )
      .default([]),
  }),
  pace_targets: z.object({
    easy: z.string().max(40),
    tempo: z.string().max(40),
    interval: z.string().max(40),
    long_run: z.string().max(40),
    race: z.string().max(40),
  }),
  hr_zones: z
    .array(z.object({ zone: z.string().max(20), bpm_range: z.tuple([z.number(), z.number()]) }))
    .default([]),
  nutrition_flags: z
    .array(
      z.object({
        biomarker: z.string().max(120),
        status: z.string().max(40),
        recommendation: z.string().max(500),
      }),
    )
    .default([]),
  weeks: z
    .array(
      z.object({
        week_number: z.number().int().min(1).max(120),
        phase: z.string().max(40),
        target_km: z.number().min(0).max(500),
        notes: z.string().max(1000).default(""),
        workouts: z.array(plannedWorkoutSchema).max(21),
      }),
    )
    .min(1)
    .max(120),
});

export type ValidatedPlanData = z.infer<typeof PlanDataSchema>;

/* ------------------------------------------------------------------ */
/* Planner chat action allowlist                                       */
/* ------------------------------------------------------------------ */

const dateOptSchema = z.string().regex(ISO_DATE).optional();

const workoutInputSchema = z.object({
  title: z.string().min(1).max(200),
  workout_type: z.enum(["strength", "mobility", "cross_training"]),
  date: dateOptSchema,
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  notes: z.string().max(2000).optional(),
});

const exerciseInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("weighted"),
    exercise: z.string().min(1).max(120),
    weight_kg: z.number().min(0).max(1000),
    reps: z.number().int().min(1).max(200),
    date: dateOptSchema,
  }),
  z.object({
    kind: z.literal("bodyweight"),
    exercise: z.string().min(1).max(120),
    reps: z.number().int().min(0).max(10000),
    date: dateOptSchema,
  }),
]);

const exerciseOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    type: z.enum(["bodyweight", "weighted"]),
    label: z.string().min(1).max(120),
    emoji: z.string().max(16).optional(),
  }),
  z.object({ op: z.literal("deactivate"), exercise: z.string().min(1).max(120) }),
  z.object({ op: z.literal("reactivate"), exercise: z.string().min(1).max(120) }),
  z.object({
    op: z.literal("set_goal"),
    exercise: z.string().min(1).max(120),
    weekly_goal: z.number().min(0).max(1_000_000).nullable(),
  }),
  z.object({
    op: z.literal("replace_catalog"),
    type: z.enum(["bodyweight", "weighted"]),
    labels: z.array(z.string().min(1).max(120)).min(1).max(30),
  }),
]);

/**
 * The ONLY actions the planner chat may execute (spec doc 09 hardening).
 * parseIntents() already falls back to `answer` on malformed shapes; this
 * schema re-validates so nothing outside the enum can ever reach an executor.
 */
export const PlannerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer") }),
  z.object({ action: z.literal("modify_plan"), instruction: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("rename_plan"), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("log_workout"), workout: workoutInputSchema }),
  z.object({ action: z.literal("log_exercise"), exercise: exerciseInputSchema }),
  z.object({ action: z.literal("edit_exercises"), ops: z.array(exerciseOpSchema).min(1).max(30) }),
  z.object({
    action: z.literal("set_steps_goal"),
    min: z.number().positive().max(10_000_000).nullable(),
    max: z.number().positive().max(10_000_000).nullable(),
  }),
  z.object({ action: z.literal("undo") }),
]);

export type ValidatedPlannerAction = z.infer<typeof PlannerActionSchema>;

/**
 * Re-validates router output against the allowlist. Any action that fails —
 * unknown name, malformed input, set_steps_goal with both bounds null — turns
 * into `answer` (the caller explains the problem); it is NEVER executed.
 */
export function validatePlannerActions(actions: PlannerAction[]): ValidatedPlannerAction[] {
  return actions.map((raw) => {
    const parsed = PlannerActionSchema.safeParse(raw);
    if (!parsed.success) return { action: "answer" as const };
    const action = parsed.data;
    if (action.action === "set_steps_goal" && action.min == null && action.max == null) {
      return { action: "answer" as const };
    }
    return action;
  });
}
