import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ versionId: z.uuid().optional() });

/**
 * POST /api/training/plans/[id]/restore — undo: restore a snapshot (given
 * versionId, or the most recent) and DELETE it, so repeated undo steps back
 * one change at a time.
 */
export const POST = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const plan = await trainingRepo.getPlan(owner, planId);
  if (!plan) return apiError(404, "not_found");

  const restoredVersionId = await trainingRepo.restorePlanVersion(owner, planId, body.versionId);
  if (!restoredVersionId) return apiError(400, "no_versions");
  return ok({ success: true, restoredVersionId });
});
