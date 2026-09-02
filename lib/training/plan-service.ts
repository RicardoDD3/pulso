/**
 * Training orchestration shared by routes and the planner chat (spec doc 09).
 *
 * - `modifyPlanWithInstruction` — the NL-modification flow used by
 *   POST /plans/[id]/modify and by the planner's `modify_plan` action.
 * - `executePlannerActions` — runs the planner chat's validated actions
 *   through the SAME repos the routes use (no internal HTTP). Only members of
 *   the PlannerActionSchema allowlist ever reach this function.
 *
 * NEW file (not a ported module): the ported lib/training/* stays untouched.
 */
import { generateJson, QuotaExceededError } from "@/lib/llm";
import { requireOwner, type Viewer } from "@/lib/authz/viewer";
import { logger } from "@/lib/logger";
import * as trainingRepo from "@/lib/db/repos/training";
import * as exercisesRepo from "@/lib/db/repos/exercises";
import {
  buildModifyPrompt,
  applyPlanPatches,
  diffPlans,
  instructionRequestsRest,
  parseRestWeekdays,
  enforceWeekdayRest,
} from "@/lib/training/plan-modifier";
import { removeRestDays, formatStepsCompact, normalizeStepsGoal } from "@/lib/training/week-tracks";
import {
  computeCatalogMutations,
  type CatalogDef,
  type ExerciseType,
} from "@/lib/training/exercise-catalog";
import { PlanPatchesSchema, type ValidatedPlannerAction } from "@/lib/training/plan-schemas";
import { type GeneratedPlan, isEditablePlan } from "@/lib/training/plan-generator-types";

// isEditablePlan moved to the client-safe types module (client components need
// it without pulling in this file's server-only deps). Re-exported for the
// server routes that import it from here.
export { isEditablePlan };

export type ModifyResult =
  | { ok: true; summary: string; planJson: GeneratedPlan }
  | { ok: false; status: number; code: string };

/**
 * NL modification: snapshot FIRST (undo covers the change even if a later
 * step fails), then modify-prompt → generateJson validated against
 * PlanPatchesSchema → applyPlanPatches → weekday-rest guarantees → save.
 */
export async function modifyPlanWithInstruction(
  viewer: Viewer,
  planId: string,
  instruction: string,
  opts: { model?: string; today?: string } = {},
): Promise<ModifyResult> {
  const owner = requireOwner(viewer);
  const plan = await trainingRepo.getPlan(owner, planId);
  if (!plan) return { ok: false, status: 404, code: "not_found" };
  if (!isEditablePlan(plan.planJson)) {
    return { ok: false, status: 400, code: "plan_format_unsupported" };
  }
  const currentPlan = plan.planJson;

  await trainingRepo.snapshotVersion(owner, planId, currentPlan, instruction);

  const { systemPrompt, userMessage } = buildModifyPrompt(currentPlan, instruction, opts.today);
  let patches;
  try {
    const result = await generateJson({
      feature: "planner",
      viewer: owner,
      model: opts.model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      schema: PlanPatchesSchema,
    });
    patches = result.value;
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, status: 429, code: "quota_exceeded" };
    logger.error({ err, planId }, "plan_modify_llm_failed");
    return { ok: false, status: 502, code: "llm_failed" };
  }

  const applied = applyPlanPatches(JSON.stringify(patches), currentPlan, {
    lockRestDays: instructionRequestsRest(instruction),
  });
  if (!applied.plan) {
    logger.warn({ planId, error: applied.error }, "plan_modify_invalid_patch");
    return { ok: false, status: 422, code: "invalid_plan_patch" };
  }
  const newPlan = applied.plan;

  // Deterministic guarantee: weekday rests the user asked for apply to EVERY
  // week even when the LLM skipped some; unrequested rests convert back to Z2.
  enforceWeekdayRest(newPlan, parseRestWeekdays(instruction));
  removeRestDays(newPlan);

  const summary = diffPlans(currentPlan, newPlan);
  await trainingRepo.savePlanJson(owner, planId, newPlan);
  await trainingRepo.rebuildPlanWorkouts(owner, planId, newPlan);
  return { ok: true, summary, planJson: newPlan };
}

/* ------------------------------------------------------------------ */
/* Planner chat action execution                                       */
/* ------------------------------------------------------------------ */

type ActionOutcome = { text: string; modified: boolean };

async function runAction(
  viewer: Viewer,
  action: Exclude<ValidatedPlannerAction, { action: "answer" }>,
  opts: { planId: string | null; model?: string; today: string },
): Promise<ActionOutcome> {
  switch (action.action) {
    case "modify_plan": {
      if (!opts.planId) return { text: "No tienes un plan activo para modificar.", modified: false };
      const result = await modifyPlanWithInstruction(viewer, opts.planId, action.instruction, {
        model: opts.model,
        today: opts.today,
      });
      if (!result.ok) {
        return { text: `No pude modificar el plan: ${result.code}.`, modified: false };
      }
      return {
        text: `✅ **Plan modificado**\n\n${result.summary}\n\nEscribe "deshacer" para revertir.`,
        modified: true,
      };
    }

    case "rename_plan": {
      if (!opts.planId) return { text: "No tienes un plan activo para renombrar.", modified: false };
      const row = await trainingRepo.updatePlanMeta(viewer, opts.planId, {
        name: action.name.trim(),
      });
      if (!row) return { text: "No pude renombrar el plan: no existe.", modified: false };
      return { text: `✏️ Renombré el plan a "${action.name.trim()}".`, modified: true };
    }

    case "undo": {
      if (!opts.planId) return { text: "No tienes un plan activo.", modified: false };
      const restored = await trainingRepo.restorePlanVersion(viewer, opts.planId);
      if (!restored) {
        return { text: "No pude deshacer: no hay cambios que deshacer.", modified: false };
      }
      return { text: "↩️ Restauré el plan a la versión anterior.", modified: true };
    }

    case "log_workout": {
      const w = action.workout;
      const date = w.date ?? opts.today;
      await trainingRepo.createManualWorkout(viewer, {
        planId: opts.planId,
        date,
        workoutType: w.workout_type,
        title: w.title,
        durationMinutes: w.duration_minutes ?? null,
        notes: w.notes ?? null,
      });
      return { text: `📝 Registré: **${w.title}** (${w.workout_type}) el ${date}.`, modified: false };
    }

    case "log_exercise": {
      const e = action.exercise;
      const date = e.date ?? opts.today;
      if (e.kind === "weighted") {
        const result = await exercisesRepo.addSet(viewer, {
          date,
          exerciseKey: e.exercise,
          weightKg: e.weight_kg,
          reps: e.reps,
        });
        if ("error" in result) {
          return {
            text:
              result.error === "unknown_exercise"
                ? `No pude registrar "${e.exercise}": no existe en tu catálogo. Créalo primero en la pestaña Ejercicios.`
                : `No pude registrar "${e.exercise}": máximo 20 sets por ejercicio por día.`,
            modified: false,
          };
        }
        return {
          text: `💪 Registré ${e.exercise}: ${e.weight_kg}kg × ${e.reps} (${date}).`,
          modified: false,
        };
      }
      const log = await exercisesRepo.upsertLog(viewer, {
        date,
        exerciseKey: e.exercise,
        reps: e.reps,
      });
      if (!log) {
        return {
          text: `No pude registrar "${e.exercise}": no existe en tu catálogo. Créalo primero en la pestaña Ejercicios.`,
          modified: false,
        };
      }
      return { text: `💪 Registré ${e.exercise}: ${e.reps} reps (${date}).`, modified: false };
    }

    case "edit_exercises": {
      const defs = await exercisesRepo.listDefinitions(viewer, { includeInactive: true });
      const catalog: CatalogDef[] = defs.map((d) => ({
        exercise_key: d.exerciseKey,
        label: d.label,
        type: d.type as ExerciseType,
        is_active: d.isActive,
      }));
      const mutations = computeCatalogMutations(catalog, action.ops);
      if (mutations.creates.length === 0 && mutations.updates.length === 0) {
        return {
          text: "El catálogo ya está como lo pides — no hubo nada que cambiar.",
          modified: false,
        };
      }
      const errors: string[] = [];
      for (const create of mutations.creates) {
        // createDefinition re-slugs from the label with the same algorithm
        // computeCatalogMutations used, so keys stay consistent.
        const row = await exercisesRepo.createDefinition(viewer, {
          label: create.label,
          emoji: create.emoji,
          color: create.color,
          type: create.type,
          increment: create.increment,
        });
        if (!row) errors.push(`No pude crear "${create.label}".`);
      }
      const idByKey = new Map(defs.map((d) => [d.exerciseKey, d.id]));
      for (const update of mutations.updates) {
        const id = idByKey.get(update.exercise_key);
        if (!id) {
          errors.push(`No encontré "${update.exercise_key}".`);
          continue;
        }
        const patch: { isActive?: boolean; weeklyGoal?: number | null } = {};
        if (update.changes.is_active !== undefined) patch.isActive = update.changes.is_active;
        if (update.changes.weekly_goal !== undefined) patch.weeklyGoal = update.changes.weekly_goal;
        const row = await exercisesRepo.updateDefinition(viewer, id, patch);
        if (!row) errors.push(`No pude actualizar "${update.exercise_key}".`);
      }
      const lines = mutations.summary.join("\n");
      if (errors.length > 0) {
        return {
          text: `Actualicé el catálogo con errores parciales:\n\n${lines}\n\nErrores:\n${errors.join("\n")}`,
          modified: false,
        };
      }
      return { text: `🏋️ **Catálogo de ejercicios actualizado**\n\n${lines}`, modified: true };
    }

    case "set_steps_goal": {
      const current = await trainingRepo.readStepsGoal(viewer);
      const goal = normalizeStepsGoal(action.min, action.max, current);
      await trainingRepo.saveStepsGoal(viewer, goal);
      return {
        text: `👟 Meta de pasos actualizada: ${formatStepsCompact(goal.min)}–${formatStepsCompact(goal.max)} por semana.`,
        modified: true,
      };
    }
  }
}

/**
 * Executes the non-answer actions in order (compound messages run all of
 * them), concatenating their texts. `modified` → the route emits the
 * `meta {planModified}` chunk so the client refreshes the plan view.
 */
export async function executePlannerActions(
  viewer: Viewer,
  actions: ValidatedPlannerAction[],
  opts: { planId: string | null; model?: string; today: string },
): Promise<{ text: string; actionLabel: string; modified: boolean }> {
  const executable = actions.filter(
    (a): a is Exclude<ValidatedPlannerAction, { action: "answer" }> => a.action !== "answer",
  );
  const outcomes: ActionOutcome[] = [];
  for (const action of executable) {
    try {
      outcomes.push(await runAction(viewer, action, opts));
    } catch (err) {
      logger.error({ err, action: action.action }, "planner_action_failed");
      outcomes.push({ text: `No pude completar la acción "${action.action}".`, modified: false });
    }
  }
  return {
    text: outcomes.map((o) => o.text).join("\n\n"),
    actionLabel: executable.map((a) => a.action).join("+"),
    modified: outcomes.some((o) => o.modified),
  };
}
