import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";

type Ctx = { params: Promise<{ id: string }> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const patchSchema = z
  .object({
    plan_id: z.uuid().nullable(),
    date: z.string().regex(DATE),
    workout_type: z.enum(["strength", "mobility", "cross_training"]),
    title: z.string().min(1).max(200),
    exercises: z.array(z.unknown()).max(50),
    duration_minutes: z.number().int().min(1).max(1440).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .partial();

/** PATCH /api/training/workouts/[id] — allowlisted fields only (never owner). */
export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const body = patchSchema.parse(await req.json());
  const workout = await trainingRepo.updateManualWorkout(owner, id, {
    ...(body.plan_id !== undefined ? { planId: body.plan_id } : {}),
    ...(body.date !== undefined ? { date: body.date } : {}),
    ...(body.workout_type !== undefined ? { workoutType: body.workout_type } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.exercises !== undefined ? { exercises: body.exercises } : {}),
    ...(body.duration_minutes !== undefined ? { durationMinutes: body.duration_minutes } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  });
  if (!workout) return apiError(404, "not_found");
  return ok({ workout });
});

/** DELETE /api/training/workouts/[id] */
export const DELETE = withApi<Ctx>(async (_req, ctx) => {
  const id = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const deleted = await trainingRepo.deleteManualWorkout(owner, id);
  if (!deleted) return apiError(404, "not_found");
  return ok({ success: true });
});
