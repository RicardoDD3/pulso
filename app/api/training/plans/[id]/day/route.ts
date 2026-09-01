import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";
import { moveExtraBetweenDays, replaceDayExtras } from "@/lib/training/carryover";
import { applyRunOverride, pruneRunOverrides } from "@/lib/training/run-assignment";
import { recalcWeekAggregates, removeRestDays } from "@/lib/training/week-tracks";
import { isEditablePlan } from "@/lib/training/plan-service";
import type { GeneratedDay } from "@/lib/training/plan-generator-types";

type Ctx = { params: Promise<{ id: string }> };

const moveExtraSchema = z.object({
  fromWeekIndex: z.number().int().min(0).max(200),
  fromDayIndex: z.number().int().min(0).max(6),
  toWeekIndex: z.number().int().min(0).max(200),
  toDayIndex: z.number().int().min(0).max(6),
  extraId: z.string().min(1).max(200),
});

const updatesSchema = z.object({
  sessionType: z.enum(["z2", "hiit", "long_run", "back_to_back", "rest"]).optional(),
  distanceKm: z.number().min(0).max(400).optional(),
  zone: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
  isKeySession: z.boolean().optional(),
  strengthDay: z.boolean().optional(),
  /** Validated in depth by replaceDayExtras (ported rules, incl. dismissals). */
  extraSessions: z.array(z.unknown()).max(10).optional(),
  runOverride: z
    .object({ activityId: z.number(), ref: z.string().min(1).max(200) })
    .optional(),
});

const bodySchema = z.union([
  z.object({ moveExtra: moveExtraSchema }),
  z.object({
    weekIndex: z.number().int().min(0).max(200),
    dayIndex: z.number().int().min(0).max(6),
    updates: updatesSchema,
  }),
]);

/**
 * PATCH /api/training/plans/[id]/day — edit one day of plan_json, or move an
 * extra session between days. Port of the original contract (spec doc 05):
 * an override-only PATCH is a matching decision, NOT a plan edit — it never
 * snapshots a version (cycling the chip must not empty the undo history).
 */
export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const owner = requireOwner(await resolveViewer());
  const body = bodySchema.parse(await req.json());

  const plan = await trainingRepo.getPlan(owner, planId);
  if (!plan) return apiError(404, "not_found");
  if (!isEditablePlan(plan.planJson)) return apiError(400, "plan_format_unsupported");
  const planJson = plan.planJson;

  /* ---- Mode A: move an extra between days ---- */
  if ("moveExtra" in body) {
    const m = body.moveExtra;
    await trainingRepo.snapshotVersion(owner, planId, planJson, "mover pendiente");
    const moved = moveExtraBetweenDays(
      planJson,
      { weekIndex: m.fromWeekIndex, dayIndex: m.fromDayIndex },
      { weekIndex: m.toWeekIndex, dayIndex: m.toDayIndex },
      m.extraId,
    );
    if (!moved.ok) return apiError(400, "invalid_input");
    planJson.peakWeeklyKm = Math.max(...planJson.weeks.map((w) => w.totalKm));
    await trainingRepo.savePlanJson(owner, planId, planJson);
    await trainingRepo.rebuildPlanWorkouts(owner, planId, planJson);
    return ok({ success: true, plan_json: planJson });
  }

  /* ---- Mode B: single-day updates ---- */
  const { weekIndex, dayIndex, updates } = body;
  const week = planJson.weeks[weekIndex];
  if (!week) return apiError(400, "invalid_input");
  const day: GeneratedDay | undefined = week.days[dayIndex];
  if (!day) return apiError(400, "invalid_input");

  const providedKeys = Object.keys(updates).filter(
    (k) => updates[k as keyof typeof updates] !== undefined,
  );
  const overrideOnly = updates.runOverride !== undefined && providedKeys.length === 1;
  if (!overrideOnly) {
    await trainingRepo.snapshotVersion(owner, planId, planJson, "edición manual (día)");
  }

  // Freeze the original weekly target so rebalance keeps measuring against it.
  if (week.targetKm == null) week.targetKm = week.totalKm;

  if (updates.sessionType !== undefined) {
    day.sessionType = updates.sessionType;
    // Reassigning the day invalidates a user-locked rest.
    if (updates.sessionType !== "rest") delete day.restLocked;
  }
  if (updates.distanceKm !== undefined) day.distanceKm = updates.distanceKm;
  if (updates.zone !== undefined) day.zone = updates.zone;
  if (updates.notes !== undefined) day.notes = updates.notes;
  if (updates.isKeySession !== undefined) day.isKeySession = updates.isKeySession;
  if (updates.strengthDay !== undefined) day.strengthDay = !!updates.strengthDay;
  if (updates.extraSessions !== undefined) {
    const res = replaceDayExtras(day, updates.extraSessions);
    if (!res.ok) return apiError(400, "invalid_input");
  }
  if (updates.runOverride !== undefined) {
    const res = applyRunOverride(day, updates.runOverride.activityId, updates.runOverride.ref);
    if (!res.ok) return apiError(400, "invalid_input");
  }

  // A rest day zeroes the run but KEEPS the strength flag (independent track).
  if (day.sessionType === "rest") {
    day.distanceKm = 0;
    day.zone = "";
    day.notes = "";
    day.isKeySession = false;
  }

  pruneRunOverrides(day);
  recalcWeekAggregates(week);
  removeRestDays(planJson);
  planJson.peakWeeklyKm = Math.max(...planJson.weeks.map((w) => w.totalKm));

  await trainingRepo.savePlanJson(owner, planId, planJson);
  await trainingRepo.rebuildPlanWorkouts(owner, planId, planJson);
  return ok({ success: true, plan_json: planJson });
});
