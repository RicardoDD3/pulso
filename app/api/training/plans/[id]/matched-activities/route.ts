import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";
import * as healthRepo from "@/lib/db/repos/health";
import { toTrainingActivity, stableActivityRef } from "@/lib/training/adapter";
import { runningActivitiesByDate } from "@/lib/training/activity-match";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/training/plans/[id]/matched-activities — every plan workout row
 * with its matched activity AND all runs of that date (double sessions).
 * Consumers that index by date must filter the `strength` rows first (a
 * strength day shares its date with the run row — original gotcha #11).
 */
export const GET = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);

  const plan = await trainingRepo.getPlan(viewer, planId);
  if (!plan) return apiError(404, "not_found");
  const workouts = await trainingRepo.planWorkoutsForPlan(viewer, planId);
  if (workouts.length === 0) return ok({ matches: [] });

  const dates = workouts.map((w) => w.date).filter((d): d is string => d != null).sort();
  if (dates.length === 0) {
    return ok({ matches: workouts.map((workout) => ({ workout, activity: null, activities: [] })) });
  }

  const workoutRows = await healthRepo.workoutsRange(viewer, dates[0], dates[dates.length - 1], {
    limit: 500,
  });
  const activities = workoutRows.map(toTrainingActivity);
  const runsByDate = runningActivitiesByDate(activities);
  const refByUuid = new Map(workoutRows.map((w) => [w.id, stableActivityRef(w.id)]));

  const matches = workouts.map((workout) => {
    const dayRuns = workout.date ? (runsByDate[workout.date] ?? []) : [];
    const matchedRef = workout.matchedWorkoutId ? refByUuid.get(workout.matchedWorkoutId) : undefined;
    const activity =
      matchedRef !== undefined ? (dayRuns.find((r) => r.activity_id === matchedRef) ?? null) : null;
    return { workout, activity, activities: dayRuns };
  });

  return ok({ matches });
});
