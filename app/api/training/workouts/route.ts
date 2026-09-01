import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  plan_id: z.uuid().optional(),
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  viewAs: z.uuid().optional(),
});

const createSchema = z.object({
  plan_id: z.uuid().nullish(),
  date: z.string().regex(DATE),
  workout_type: z.enum(["strength", "mobility", "cross_training"]),
  title: z.string().min(1).max(200),
  exercises: z.array(z.unknown()).max(50).optional(),
  duration_minutes: z.number().int().min(1).max(1440).nullish(),
  notes: z.string().max(2000).nullish(),
});

/**
 * GET /api/training/workouts — manual workouts. Filter precedence mirrors the
 * original: plan_id → from+to → most recent 50.
 */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const workouts = query.plan_id
    ? await trainingRepo.listManualWorkoutsForPlan(viewer, query.plan_id)
    : query.from && query.to
      ? await trainingRepo.listManualWorkouts(viewer, query.from, query.to)
      : await trainingRepo.listRecentManualWorkouts(viewer, 50);
  return ok({ workouts });
});

/** POST /api/training/workouts — log a manual workout. */
export const POST = withApi(async (req) => {
  const owner = requireOwner(await resolveViewer());
  const body = createSchema.parse(await req.json());
  const workout = await trainingRepo.createManualWorkout(owner, {
    planId: body.plan_id ?? null,
    date: body.date,
    workoutType: body.workout_type,
    title: body.title,
    exercises: body.exercises ?? [],
    durationMinutes: body.duration_minutes ?? null,
    notes: body.notes ?? null,
  });
  return ok({ workout });
});
