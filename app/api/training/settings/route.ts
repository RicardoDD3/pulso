import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";
import { normalizeStepsGoal } from "@/lib/training/week-tracks";

const patchSchema = z
  .object({
    stepsGoalMin: z.number().positive().max(10_000_000),
    stepsGoalMax: z.number().positive().max(10_000_000),
    // Original aliases (the planner action used them).
    min: z.number().positive().max(10_000_000),
    max: z.number().positive().max(10_000_000),
  })
  .partial();

/** GET /api/training/settings — weekly steps goal (defaults 150k–200k). */
export const GET = withApi(async (req) => {
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const goal = await trainingRepo.readStepsGoal(viewer);
  return ok({ stepsGoalMin: goal.min, stepsGoalMax: goal.max });
});

/**
 * PATCH /api/training/settings — partial merge: only provided fields change,
 * normalizeStepsGoal guarantees max >= min against the current goal.
 */
export const PATCH = withApi(async (req) => {
  const owner = requireOwner(await resolveViewer());
  const body = patchSchema.parse(await req.json().catch(() => ({})));
  const current = await trainingRepo.readStepsGoal(owner);
  const goal = normalizeStepsGoal(body.stepsGoalMin ?? body.min, body.stepsGoalMax ?? body.max, current);
  await trainingRepo.saveStepsGoal(owner, goal);
  return ok({ stepsGoalMin: goal.min, stepsGoalMax: goal.max });
});
