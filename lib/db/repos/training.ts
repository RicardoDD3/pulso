/**
 * Training repo (spec docs 02/09) — the reads the coach health-context needs:
 * active plan, its plan workouts, the user's training settings and manual
 * workouts. Plan WRITES belong to the planner actions (doc 09), not here.
 */
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireScope, type Viewer } from "@/lib/authz/viewer";

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
  return row ?? null;
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
