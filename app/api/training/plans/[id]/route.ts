import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    status: z.enum(["active", "completed", "abandoned"]),
    name: z.string().min(1).max(120),
  })
  .partial()
  .refine((p) => p.status !== undefined || p.name !== undefined, {
    message: "status or name required",
  });

/** GET /api/training/plans/[id] — plan (normalized plan_json) + its workouts. */
export const GET = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const plan = await trainingRepo.getPlan(viewer, planId);
  if (!plan) return apiError(404, "not_found");
  const workouts = await trainingRepo.planWorkoutsForPlan(viewer, planId);
  return ok({ plan, workouts });
});

/** PATCH /api/training/plans/[id] — status and/or name. */
export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const patch = patchSchema.parse(await req.json());
  const plan = await trainingRepo.updatePlanMeta(owner, planId, {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
  });
  if (!plan) return apiError(404, "not_found");
  return ok({ plan });
});

/** DELETE /api/training/plans/[id] — plan + workouts/versions (FK cascade). */
export const DELETE = withApi<Ctx>(async (_req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const deleted = await trainingRepo.deletePlan(owner, planId);
  if (!deleted) return apiError(404, "not_found");
  return ok({ success: true });
});
