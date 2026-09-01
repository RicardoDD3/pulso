import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { getFeatures } from "@/lib/system/features";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { todayInTz } from "@/lib/health/tz";
import { modifyPlanWithInstruction } from "@/lib/training/plan-service";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  instruction: z.string().min(1).max(4000),
  model: z.string().max(80).optional(),
});

/**
 * POST /api/training/plans/[id]/modify — natural-language plan modification
 * (used by the plan view and the planner chat's modify_plan action).
 * Snapshot FIRST, then modify-prompt → Zod-validated patches → apply → save.
 */
export const POST = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  if (!getFeatures().chatEnabled) return apiError(400, "feature_disabled");
  const body = bodySchema.parse(await req.json());

  const profile = await profilesRepo.getProfile(owner);
  const result = await modifyPlanWithInstruction(owner, planId, body.instruction, {
    model: body.model,
    today: todayInTz(profile.timezone || "UTC"),
  });
  if (!result.ok) return apiError(result.status, result.code);
  return ok({ success: true, summary: result.summary });
});
