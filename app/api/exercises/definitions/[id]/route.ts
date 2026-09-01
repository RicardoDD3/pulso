import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as exercisesRepo from "@/lib/db/repos/exercises";

const patchSchema = z
  .object({
    label: z.string().min(1).max(60),
    emoji: z.string().min(1).max(8),
    color: z.string().min(1).max(20),
    increment: z.number().int().min(1).max(100),
    weeklyGoal: z.number().int().min(0).max(100000).nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10000),
  })
  .partial();

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const parsedId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const patch = patchSchema.parse(await req.json());
  const definition = await exercisesRepo.updateDefinition(viewer, parsedId, patch);
  if (!definition) return apiError(404, "not_found");
  return ok({ definition });
});

/** No hard-delete of the catalog (original policy) — hide via PATCH isActive. */
export const DELETE = withApi(async () => {
  await resolveViewer();
  return apiError(403, "catalog_no_delete");
});
