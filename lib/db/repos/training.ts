/**
 * Training repo (spec docs 02/09) — Viewer-scoped access to plans, plan
 * workouts, versions, settings and manual workouts.
 *
 * Invariant (spec doc 09): `plan_json` passes through `normalizeStrength` +
 * `removeRestDays` on EVERY read and write path — legacy strength days become
 * flags and unlocked rest days are redistributed, no matter which route
 * touched the plan. `normalizePlanJson` is the single (pure, exported,
 * tested) place that enforces it.
 */
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireOwner, requireScope, type Viewer } from "@/lib/authz/viewer";
import { normalizeStrength, removeRestDays } from "@/lib/training/week-tracks";
import { versionsToPrune } from "@/lib/training/plan-versions";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";
import type { PlanData } from "@/lib/training/types";

/* ------------------------------------------------------------------ */
/* plan_json normalization (pure)                                      */
/* ------------------------------------------------------------------ */

/**
 * Applies both normalizations in place when the payload looks like a
 * GeneratedPlan; LLM-format plans (weeks[].workouts[], no days) pass through
 * untouched. Returns whether anything changed (the sync route persists only
 * when it did).
 */
export function normalizePlanJson(planJson: unknown): boolean {
  const plan = planJson as GeneratedPlan | null;
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.every((w) => Array.isArray(w?.days))) {
    return false;
  }
  const a = normalizeStrength(plan);
  const b = removeRestDays(plan);
  return a || b;
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

export async function listPlans(viewer: Viewer) {
  requireScope(viewer, "training");
  return getDb()
    .select({
      id: schema.trainingPlans.id,
      name: schema.trainingPlans.name,
      goalType: schema.trainingPlans.goalType,
      goalDate: schema.trainingPlans.goalDate,
      goalTime: schema.trainingPlans.goalTime,
      goalDistanceKm: schema.trainingPlans.goalDistanceKm,
      status: schema.trainingPlans.status,
      llmUsed: schema.trainingPlans.llmUsed,
      createdAt: schema.trainingPlans.createdAt,
    })
    .from(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, viewer.effectiveUserId))
    .orderBy(desc(schema.trainingPlans.createdAt));
}

export async function activePlan(viewer: Viewer) {
  requireScope(viewer, "training");
  const [row] = await getDb()
    .select()
    .from(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.userId, viewer.effectiveUserId),
        eq(schema.trainingPlans.status, "active"),
      ),
    )
    .orderBy(desc(schema.trainingPlans.createdAt))
    .limit(1);
  if (row) normalizePlanJson(row.planJson);
  return row ?? null;
}

/**
 * Plan row WITHOUT normalization — only for the sync route, which needs the
 * "did normalization change anything" signal to persist + rebuild once.
 * Every other caller uses getPlan.
 */
export async function getPlanRaw(viewer: Viewer, planId: string) {
  requireScope(viewer, "training");
  const [row] = await getDb()
    .select()
    .from(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.id, planId),
        eq(schema.trainingPlans.userId, viewer.effectiveUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Full plan row with plan_json normalized on read. Null when not owned/found. */
export async function getPlan(viewer: Viewer, planId: string) {
  requireScope(viewer, "training");
  const [row] = await getDb()
    .select()
    .from(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.id, planId),
        eq(schema.trainingPlans.userId, viewer.effectiveUserId),
      ),
    )
    .limit(1);
  if (row) normalizePlanJson(row.planJson);
  return row ?? null;
}

export async function createPlan(
  viewer: Viewer,
  input: {
    name: string;
    goalType: string | null;
    goalDate: string | null;
    goalTime?: string | null;
    goalDistanceKm?: number | null;
    availableDays?: unknown;
    terrain?: string | null;
    planJson: unknown;
    llmUsed: string;
  },
) {
  const owner = requireOwner(viewer);
  normalizePlanJson(input.planJson);
  const [row] = await getDb()
    .insert(schema.trainingPlans)
    .values({
      userId: owner.userId,
      name: input.name,
      goalType: input.goalType,
      goalDate: input.goalDate,
      goalTime: input.goalTime ?? null,
      goalDistanceKm: input.goalDistanceKm ?? null,
      availableDays: input.availableDays ?? null,
      terrain: input.terrain ?? null,
      planJson: input.planJson,
      llmUsed: input.llmUsed,
      status: "active",
    })
    .returning();
  return row;
}

export async function updatePlanMeta(
  viewer: Viewer,
  planId: string,
  patch: Partial<{ status: string; name: string }>,
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .update(schema.trainingPlans)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(schema.trainingPlans.id, planId), eq(schema.trainingPlans.userId, owner.userId)),
    )
    .returning();
  if (row) normalizePlanJson(row.planJson);
  return row ?? null;
}

export async function deletePlan(viewer: Viewer, planId: string) {
  const owner = requireOwner(viewer);
  const deleted = await getDb()
    .delete(schema.trainingPlans)
    .where(
      and(eq(schema.trainingPlans.id, planId), eq(schema.trainingPlans.userId, owner.userId)),
    )
    .returning({ id: schema.trainingPlans.id });
  return deleted.length > 0;
}

/** Normalizes and persists plan_json. Returns false when the plan is not owned. */
export async function savePlanJson(viewer: Viewer, planId: string, planJson: unknown) {
  const owner = requireOwner(viewer);
  normalizePlanJson(planJson);
  const updated = await getDb()
    .update(schema.trainingPlans)
    .set({ planJson, updatedAt: new Date() })
    .where(
      and(eq(schema.trainingPlans.id, planId), eq(schema.trainingPlans.userId, owner.userId)),
    )
    .returning({ id: schema.trainingPlans.id });
  return updated.length > 0;
}

/* ------------------------------------------------------------------ */
/* Plan workouts (unpack / rebuild / match updates)                    */
/* ------------------------------------------------------------------ */

const SESSION_TYPE_TO_WORKOUT_TYPE: Record<string, string> = {
  z2: "easy_run",
  hiit: "intervals",
  long_run: "long_run",
  back_to_back: "long_run",
  strength: "strength",
};

export type PlanWorkoutSeed = {
  weekNumber: number;
  dayOfWeek: number;
  date: string | null;
  workoutType: string;
  title: string | null;
  targetDistanceKm: number | null;
  targetPaceRange: string | null;
  targetHrZone: string | null;
};

/**
 * Pure unpack of a GeneratedPlan (deterministic/edited format) into plan
 * workout rows: one per non-rest day, plus a "strength" row per strengthDay
 * flag. Extra sessions NEVER produce rows — they live only in plan_json.
 */
export function planWorkoutSeedsFromGeneratedPlan(plan: GeneratedPlan): PlanWorkoutSeed[] {
  const rows: PlanWorkoutSeed[] = [];
  for (const week of plan.weeks ?? []) {
    for (const day of week.days ?? []) {
      if (day.sessionType !== "rest") {
        rows.push({
          weekNumber: week.weekNumber,
          dayOfWeek: day.dayOfWeek,
          date: day.date,
          workoutType: SESSION_TYPE_TO_WORKOUT_TYPE[day.sessionType] ?? "easy_run",
          title: day.zone || null,
          targetDistanceKm: day.distanceKm || null,
          targetPaceRange: null,
          targetHrZone: null,
        });
      }
      if (day.strengthDay && day.sessionType !== "strength") {
        rows.push({
          weekNumber: week.weekNumber,
          dayOfWeek: day.dayOfWeek,
          date: day.date,
          workoutType: "strength",
          title: "Fuerza",
          targetDistanceKm: null,
          targetPaceRange: null,
          targetHrZone: null,
        });
      }
    }
  }
  return rows;
}

/** Pure unpack of an LLM PlanData (weeks[].workouts[]) into plan workout rows. */
export function planWorkoutSeedsFromPlanData(planData: PlanData): PlanWorkoutSeed[] {
  return (planData.weeks ?? []).flatMap((week) =>
    (week.workouts ?? []).map((w) => ({
      weekNumber: week.week_number,
      dayOfWeek: w.day_of_week,
      date: w.date ?? null,
      workoutType: w.workout_type,
      title: w.title ?? null,
      targetDistanceKm: w.target_distance_km ?? null,
      targetPaceRange: w.target_pace_range ?? null,
      targetHrZone: w.target_hr_zone ?? null,
    })),
  );
}

export async function insertPlanWorkouts(viewer: Viewer, planId: string, seeds: PlanWorkoutSeed[]) {
  const owner = requireOwner(viewer);
  if (seeds.length === 0) return;
  await getDb()
    .insert(schema.trainingPlanWorkouts)
    .values(seeds.map((s) => ({ ...s, planId, userId: owner.userId, status: "pending" })));
}

/**
 * Rebuild of training_plan_workouts from plan_json, preserving completion
 * data by (date|workout_type) — port of rebuildPlanWorkouts (plan-modifier).
 */
export async function rebuildPlanWorkouts(viewer: Viewer, planId: string, plan: GeneratedPlan) {
  const owner = requireOwner(viewer);
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.trainingPlanWorkouts)
    .where(
      and(
        eq(schema.trainingPlanWorkouts.planId, planId),
        eq(schema.trainingPlanWorkouts.userId, owner.userId),
      ),
    );
  const completedByKey = new Map(
    existing
      .filter((w) => w.status === "completed")
      .map((w) => [`${w.date}|${w.workoutType}`, w] as const),
  );
  const seeds = planWorkoutSeedsFromGeneratedPlan(plan);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.trainingPlanWorkouts)
      .where(
        and(
          eq(schema.trainingPlanWorkouts.planId, planId),
          eq(schema.trainingPlanWorkouts.userId, owner.userId),
        ),
      );
    if (seeds.length === 0) return;
    await tx.insert(schema.trainingPlanWorkouts).values(
      seeds.map((s) => {
        const done = completedByKey.get(`${s.date}|${s.workoutType}`);
        return {
          ...s,
          planId,
          userId: owner.userId,
          status: done?.status ?? "pending",
          matchedWorkoutId: done?.matchedWorkoutId ?? null,
          matchedManualId: done?.matchedManualId ?? null,
          actualDistanceKm: done?.actualDistanceKm ?? null,
          actualPace: done?.actualPace ?? null,
        };
      }),
    );
  });
}

/** Plan workouts bound by (plan_id AND user_id) — never plan_id alone (doc 06). */
export async function planWorkoutsForPlan(viewer: Viewer, planId: string) {
  requireScope(viewer, "training");
  return getDb()
    .select()
    .from(schema.trainingPlanWorkouts)
    .where(
      and(
        eq(schema.trainingPlanWorkouts.planId, planId),
        eq(schema.trainingPlanWorkouts.userId, viewer.effectiveUserId),
      ),
    )
    .orderBy(asc(schema.trainingPlanWorkouts.date));
}

/** Match/status update on a single plan workout row (sync + manual edits). */
export async function updatePlanWorkout(
  viewer: Viewer,
  rowId: string,
  patch: Partial<{
    status: string;
    matchedWorkoutId: string | null;
    matchedManualId: string | null;
    actualDistanceKm: number | null;
    actualPace: string | null;
  }>,
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .update(schema.trainingPlanWorkouts)
    .set(patch)
    .where(
      and(
        eq(schema.trainingPlanWorkouts.id, rowId),
        eq(schema.trainingPlanWorkouts.userId, owner.userId),
      ),
    )
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Versions (undo)                                                     */
/* ------------------------------------------------------------------ */

export const KEEP_VERSIONS = 10;

/**
 * Pure wiring of versionsToPrune (numeric ids in the ported helper) onto uuid
 * rows: newest KEEP_VERSIONS survive, the rest are returned for deletion.
 */
export function versionIdsToPrune(
  rows: Array<{ id: string; createdAt: Date }>,
  keep = KEEP_VERSIONS,
): string[] {
  const surrogates = rows.map((row, i) => ({ id: i, created_at: row.createdAt.toISOString() }));
  return versionsToPrune(surrogates, keep).map((i) => rows[i].id);
}

/**
 * Snapshot of plan_json BEFORE an edit overwrites it, then prune to the
 * KEEP_VERSIONS most recent. Best-effort caller-side: routes snapshot before
 * mutating so undo steps back regardless of which route edited.
 */
export async function snapshotVersion(
  viewer: Viewer,
  planId: string,
  planJson: unknown,
  label: string,
) {
  const owner = requireOwner(viewer);
  const db = getDb();
  await db.insert(schema.trainingPlanVersions).values({
    planId,
    userId: owner.userId,
    planJson,
    label: label.slice(0, 80),
  });
  const rows = await db
    .select({
      id: schema.trainingPlanVersions.id,
      createdAt: schema.trainingPlanVersions.createdAt,
    })
    .from(schema.trainingPlanVersions)
    .where(
      and(
        eq(schema.trainingPlanVersions.planId, planId),
        eq(schema.trainingPlanVersions.userId, owner.userId),
      ),
    );
  const prune = versionIdsToPrune(rows);
  if (prune.length > 0) {
    await db
      .delete(schema.trainingPlanVersions)
      .where(inArray(schema.trainingPlanVersions.id, prune));
  }
}

export async function listVersions(viewer: Viewer, planId: string) {
  requireScope(viewer, "training");
  return getDb()
    .select({
      id: schema.trainingPlanVersions.id,
      label: schema.trainingPlanVersions.label,
      createdAt: schema.trainingPlanVersions.createdAt,
    })
    .from(schema.trainingPlanVersions)
    .where(
      and(
        eq(schema.trainingPlanVersions.planId, planId),
        eq(schema.trainingPlanVersions.userId, viewer.effectiveUserId),
      ),
    )
    .orderBy(desc(schema.trainingPlanVersions.createdAt));
}

/**
 * Undo: restore a snapshot (given version, or the most recent), rebuild plan
 * workouts and DELETE the restored version — repeated undo steps back one
 * change at a time. Returns the restored version id, or null without versions.
 */
export async function restorePlanVersion(viewer: Viewer, planId: string, versionId?: string) {
  const owner = requireOwner(viewer);
  const db = getDb();
  const conditions = [
    eq(schema.trainingPlanVersions.planId, planId),
    eq(schema.trainingPlanVersions.userId, owner.userId),
  ];
  if (versionId) conditions.push(eq(schema.trainingPlanVersions.id, versionId));
  const [version] = await db
    .select()
    .from(schema.trainingPlanVersions)
    .where(and(...conditions))
    .orderBy(desc(schema.trainingPlanVersions.createdAt))
    .limit(1);
  if (!version) return null;

  const restored = version.planJson;
  await savePlanJson(owner, planId, restored);
  const plan = restored as GeneratedPlan;
  if (Array.isArray(plan?.weeks)) await rebuildPlanWorkouts(owner, planId, plan);
  await db
    .delete(schema.trainingPlanVersions)
    .where(eq(schema.trainingPlanVersions.id, version.id));
  return version.id;
}

/* ------------------------------------------------------------------ */
/* Settings (weekly steps goal)                                        */
/* ------------------------------------------------------------------ */

export const STEPS_GOAL_DEFAULTS = { min: 150_000, max: 200_000 };

/** Null when the user never saved settings — callers fall back to the defaults. */
export async function getTrainingSettings(viewer: Viewer) {
  requireScope(viewer, "training");
  const [row] = await getDb()
    .select()
    .from(schema.trainingSettings)
    .where(eq(schema.trainingSettings.userId, viewer.effectiveUserId))
    .limit(1);
  return row ?? null;
}

/** Steps goal with defaults applied (150k–200k when there is no row). */
export async function readStepsGoal(viewer: Viewer) {
  const row = await getTrainingSettings(viewer);
  if (!row) return { ...STEPS_GOAL_DEFAULTS };
  return { min: row.stepsGoalMin, max: row.stepsGoalMax };
}

export async function saveStepsGoal(viewer: Viewer, goal: { min: number; max: number }) {
  const owner = requireOwner(viewer);
  await getDb()
    .insert(schema.trainingSettings)
    .values({
      userId: owner.userId,
      stepsGoalMin: goal.min,
      stepsGoalMax: goal.max,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.trainingSettings.userId,
      set: { stepsGoalMin: goal.min, stepsGoalMax: goal.max, updatedAt: new Date() },
    });
  return goal;
}

/* ------------------------------------------------------------------ */
/* Manual workouts                                                     */
/* ------------------------------------------------------------------ */

export async function listManualWorkouts(viewer: Viewer, from: string, to: string) {
  requireScope(viewer, "training");
  return getDb()
    .select()
    .from(schema.manualWorkouts)
    .where(
      and(
        eq(schema.manualWorkouts.userId, viewer.effectiveUserId),
        gte(schema.manualWorkouts.date, from),
        lte(schema.manualWorkouts.date, to),
      ),
    )
    .orderBy(desc(schema.manualWorkouts.date))
    .limit(500);
}

export async function listManualWorkoutsForPlan(viewer: Viewer, planId: string) {
  requireScope(viewer, "training");
  return getDb()
    .select()
    .from(schema.manualWorkouts)
    .where(
      and(
        eq(schema.manualWorkouts.userId, viewer.effectiveUserId),
        eq(schema.manualWorkouts.planId, planId),
      ),
    )
    .orderBy(desc(schema.manualWorkouts.date));
}

export async function listRecentManualWorkouts(viewer: Viewer, limit = 50) {
  requireScope(viewer, "training");
  return getDb()
    .select()
    .from(schema.manualWorkouts)
    .where(eq(schema.manualWorkouts.userId, viewer.effectiveUserId))
    .orderBy(desc(schema.manualWorkouts.date))
    .limit(Math.min(limit, 200));
}

export async function createManualWorkout(
  viewer: Viewer,
  input: {
    planId?: string | null;
    date: string;
    workoutType: string;
    title: string;
    exercises?: unknown;
    durationMinutes?: number | null;
    notes?: string | null;
  },
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .insert(schema.manualWorkouts)
    .values({
      userId: owner.userId,
      planId: input.planId ?? null,
      date: input.date,
      workoutType: input.workoutType,
      title: input.title,
      exercises: input.exercises ?? [],
      durationMinutes: input.durationMinutes ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function updateManualWorkout(
  viewer: Viewer,
  id: string,
  patch: Partial<{
    planId: string | null;
    date: string;
    workoutType: string;
    title: string;
    exercises: unknown;
    durationMinutes: number | null;
    notes: string | null;
  }>,
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .update(schema.manualWorkouts)
    .set(patch)
    .where(
      and(eq(schema.manualWorkouts.id, id), eq(schema.manualWorkouts.userId, owner.userId)),
    )
    .returning();
  return row ?? null;
}

export async function deleteManualWorkout(viewer: Viewer, id: string) {
  const owner = requireOwner(viewer);
  const deleted = await getDb()
    .delete(schema.manualWorkouts)
    .where(
      and(eq(schema.manualWorkouts.id, id), eq(schema.manualWorkouts.userId, owner.userId)),
    )
    .returning({ id: schema.manualWorkouts.id });
  return deleted.length > 0;
}
