import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import * as trainingRepo from "@/lib/db/repos/training";
import * as healthRepo from "@/lib/db/repos/health";
import * as exercisesRepo from "@/lib/db/repos/exercises";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { todayInTz } from "@/lib/health/tz";
import { toTrainingActivity, stableActivityRef } from "@/lib/training/adapter";
import { runningActivitiesByDate, needsMatchUpdate } from "@/lib/training/activity-match";
import { assignedAggregate } from "@/lib/training/run-assignment";
import { applyCarryover, type RunsByDate } from "@/lib/training/carryover";
import {
  computeStrengthCompletions,
  type StrengthPlanWorkoutRow,
} from "@/lib/training/strength-completion";
import { isEditablePlan } from "@/lib/training/plan-service";
import type { GeneratedDay } from "@/lib/training/plan-generator-types";

type Ctx = { params: Promise<{ id: string }> };

const RUN_TYPES = new Set(["easy_run", "long_run", "tempo", "intervals", "recovery_run"]);
const LOCK_TTL_S = 60;

/**
 * POST /api/training/plans/[id]/sync — match canonical workouts to plan
 * workouts (via the adapter) and recompute carryover + strength completion.
 * Auto-runs when the plan view loads; a per-plan Redis lock keeps concurrent
 * syncs from running twice (spec doc 09).
 */
export const POST = withApi<Ctx>(async (_req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());

  const lockKey = `training:sync:${planId}`;
  let locked = false;
  try {
    locked = (await getRedis().set(lockKey, "1", "EX", LOCK_TTL_S, "NX")) === "OK";
  } catch (err) {
    // No Redis → sync still works, just without the concurrency guard.
    logger.warn({ err }, "training_sync_lock_unavailable");
    locked = true;
  }
  if (!locked) return apiError(409, "sync_locked");

  try {
    const plan = await trainingRepo.getPlanRaw(owner, planId);
    if (!plan) return apiError(404, "not_found");

    // Persisted normalization: ex-rest days gain plan-workout rows to match.
    if (isEditablePlan(plan.planJson) && trainingRepo.normalizePlanJson(plan.planJson)) {
      await trainingRepo.savePlanJson(owner, planId, plan.planJson);
      await trainingRepo.rebuildPlanWorkouts(owner, planId, plan.planJson);
    }
    const planJson = plan.planJson;

    const allWorkouts = await trainingRepo.planWorkoutsForPlan(owner, planId);
    const runWorkouts = allWorkouts.filter((w) => RUN_TYPES.has(w.workoutType) && w.date);
    if (runWorkouts.length === 0) return ok({ synced: 0 });

    const dates = runWorkouts.map((w) => w.date as string).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];

    const workoutRows = await healthRepo.workoutsRange(owner, from, to, { limit: 500 });
    const activities = workoutRows.map(toTrainingActivity);
    const uuidByRef = new Map(workoutRows.map((w) => [stableActivityRef(w.id), w.id]));
    const runsByDate = runningActivitiesByDate(activities) as RunsByDate;

    const dayByDate = new Map<string, GeneratedDay>();
    if (isEditablePlan(planJson)) {
      for (const week of planJson.weeks) {
        for (const day of week.days) dayByDate.set(day.date, day);
      }
    }

    let synced = 0;

    // Per-day match: only runs ASSIGNED to one of the day's sessions count.
    for (const pw of runWorkouts) {
      const day = dayByDate.get(pw.date as string);
      const runs = runsByDate[pw.date as string];
      if (!day || !runs?.length) continue;
      const agg = assignedAggregate(day, runs);
      if (!agg) continue;
      const storedRef = pw.matchedWorkoutId ? stableActivityRef(pw.matchedWorkoutId) : null;
      if (!needsMatchUpdate({ matched_activity_id: storedRef, actual_distance_km: pw.actualDistanceKm }, agg)) {
        continue;
      }
      await trainingRepo.updatePlanWorkout(owner, pw.id, {
        matchedWorkoutId: uuidByRef.get(agg.matchedActivityId) ?? null,
        status: "completed",
        actualDistanceKm: agg.actualDistanceKm,
        actualPace: agg.actualPace == null ? null : agg.actualPace.toFixed(2),
      });
      synced++;
    }

    // Automatic per-session carryover ("today" in the user's timezone).
    if (isEditablePlan(planJson)) {
      const profile = await profilesRepo.getProfile(owner);
      const todayISO = todayInTz(profile.timezone || "UTC");
      if (applyCarryover(planJson, runsByDate, todayISO)) {
        await trainingRepo.savePlanJson(owner, planId, planJson);
      }
    }

    // Strength: a planned strength day completes with a manual strength
    // workout OR at least one weighted set — same rule as the UI.
    const strengthWorkouts = allWorkouts.filter((w) => w.workoutType === "strength" && w.date);
    if (strengthWorkouts.length > 0) {
      const sDates = strengthWorkouts.map((w) => w.date as string).sort();
      const [manualRows, setRows] = await Promise.all([
        trainingRepo.listManualWorkouts(owner, sDates[0], sDates[sDates.length - 1]),
        exercisesRepo.listSets(owner, { from: sDates[0], to: sDates[sDates.length - 1] }),
      ]);

      // The ported helper speaks numeric ids; surrogate indexes map back to uuids.
      const manualStrength = manualRows.filter((m) => m.workoutType === "strength");
      const manualByDate = new Map<string, { id: number }>();
      const manualUuidBySurrogate = new Map<number, string>();
      manualStrength.forEach((m, i) => {
        if (!manualByDate.has(m.date)) {
          manualByDate.set(m.date, { id: i + 1 });
          manualUuidBySurrogate.set(i + 1, m.id);
        }
      });
      const weightedSetDates = new Set(setRows.map((s) => s.date));
      const rows: StrengthPlanWorkoutRow[] = strengthWorkouts.map((pw, i) => ({
        id: i,
        date: pw.date as string,
        status: pw.status,
        matched_workout_id: pw.matchedManualId ? 1 : null,
      }));

      for (const update of computeStrengthCompletions(rows, manualByDate, weightedSetDates)) {
        const target = strengthWorkouts[update.id];
        await trainingRepo.updatePlanWorkout(owner, target.id, {
          status: "completed",
          ...(update.matched_workout_id !== undefined
            ? { matchedManualId: manualUuidBySurrogate.get(update.matched_workout_id) ?? null }
            : {}),
        });
        synced++;
      }
    }

    return ok({ synced });
  } finally {
    try {
      await getRedis().del(lockKey);
    } catch {
      /* lock expires on its own via TTL */
    }
  }
});
