import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";
import { normalizeStrength, removeRestDays, recalcWeekAggregates } from "@/lib/training/week-tracks";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";

export const dynamic = "force-dynamic";

/**
 * POST /api/training/plans/[id]/rebalance — apply an explicit rebalance
 * (the proposal is computed client-side in lib/training/rebalance.ts) or
 * dismiss a proposal. Ported from the original; adapted to Viewer + repos.
 * ALL patches share ONE version snapshot (fixes the N-snapshots workaround
 * the week-editor used while this route was missing).
 */
const patchSchema = z.object({
  weekIndex: z.number().int().min(0).max(60),
  dayIndex: z.number().int().min(0).max(6),
  distanceKm: z.number().min(0).max(300),
});

const bodySchema = z.union([
  z.object({ patches: z.array(patchSchema).min(1) }),
  z.object({ dismiss: z.object({ weekIndex: z.number().int().min(0).max(60), key: z.string().max(80) }) }),
]);

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const planId = z.uuid().parse(id);
  const viewer = requireOwner(await resolveViewer());
  const body = bodySchema.parse(await req.json());

  const raw = await trainingRepo.getPlanRaw(viewer, planId);
  if (!raw) return apiError(404, "not_found");
  const planJson = raw.planJson as GeneratedPlan;
  if (!planJson?.weeks) return apiError(400, "invalid_input");

  // Migrate legacy plans + redistribute rest (verbatim invariants).
  normalizeStrength(planJson);
  removeRestDays(planJson);

  if ("dismiss" in body) {
    const week = planJson.weeks[body.dismiss.weekIndex];
    if (!week) return apiError(400, "invalid_input");
    week.rebalanceDismissed = String(body.dismiss.key);
    await trainingRepo.savePlanJson(viewer, planId, planJson);
    return ok({ success: true, planJson });
  }

  // Validate every patch before touching anything.
  for (const p of body.patches) {
    const week = planJson.weeks[p.weekIndex];
    if (!week || !week.days[p.dayIndex]) return apiError(400, "invalid_input");
  }

  // ONE snapshot for the whole rebalance (after validation, before applying).
  await trainingRepo.snapshotVersion(viewer, planId, planJson, "rebalanceo semanal");

  const touchedWeeks = new Set<number>();
  for (const p of body.patches) {
    const week = planJson.weeks[p.weekIndex];
    // Freeze the target volume before the first change so the delta keeps
    // measuring against the original plan.
    if (week.targetKm == null) week.targetKm = week.totalKm;
    week.days[p.dayIndex].distanceKm = p.distanceKm;
    touchedWeeks.add(p.weekIndex);
  }
  for (const wi of touchedWeeks) {
    const week = planJson.weeks[wi];
    recalcWeekAggregates(week);
    delete week.rebalanceDismissed;
  }
  planJson.peakWeeklyKm = Math.max(...planJson.weeks.map((w) => w.totalKm));

  await trainingRepo.savePlanJson(viewer, planId, planJson);
  await trainingRepo.rebuildPlanWorkouts(viewer, planId, planJson);
  return ok({ success: true, planJson });
});
