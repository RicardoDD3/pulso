import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";
import { moveSection, type SwapSection } from "@/lib/training/week-tracks";
import { isEditablePlan } from "@/lib/training/plan-service";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    weekIndex: z.number().int().min(0).max(200),
    fromDayIndex: z.number().int().min(0).max(6),
    toDayIndex: z.number().int().min(0).max(6),
    section: z.enum(["run", "strength"]).optional(),
  })
  .refine((b) => b.fromDayIndex !== b.toDayIndex, { message: "same day" });

/**
 * POST /api/training/plans/[id]/move — move a section (run | strength) from
 * one day to another inside a week. The source day gets NOTHING back (this
 * replaced the old swap); placeSession decides merge/adopt/new-chip and the
 * key-session star travels with the work.
 */
export const POST = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const body = bodySchema.parse(await req.json());
  const section: SwapSection = body.section === "strength" ? "strength" : "run";

  const plan = await trainingRepo.getPlan(owner, planId);
  if (!plan) return apiError(404, "not_found");
  if (!isEditablePlan(plan.planJson)) return apiError(400, "plan_format_unsupported");
  const planJson = plan.planJson;
  const week = planJson.weeks[body.weekIndex];
  if (!week) return apiError(400, "invalid_input");

  await trainingRepo.snapshotVersion(owner, planId, planJson, "edición manual (mover)");

  // moveSection recalcula los totales de la semana (recalcWeekAggregates).
  moveSection(week, body.fromDayIndex, body.toDayIndex, section);
  planJson.peakWeeklyKm = Math.max(...planJson.weeks.map((w) => w.totalKm));

  await trainingRepo.savePlanJson(owner, planId, planJson);
  await trainingRepo.rebuildPlanWorkouts(owner, planId, planJson);
  return ok({ success: true, plan_json: planJson });
});
