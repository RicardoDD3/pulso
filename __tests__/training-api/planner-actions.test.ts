/**
 * Planner chat execution allowlist (spec doc 09 hardening): only validated
 * actions run, each through the repos — mocked here, no DB and no LLM.
 */
import type { Viewer } from "@/lib/authz/viewer";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";

jest.mock("@/lib/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

jest.mock("@/lib/llm", () => ({
  generateJson: jest.fn(),
  QuotaExceededError: class QuotaExceededError extends Error {},
}));

jest.mock("@/lib/db/repos/training", () => {
  const actual = jest.requireActual("@/lib/db/repos/training");
  return {
    ...actual,
    getPlan: jest.fn(),
    snapshotVersion: jest.fn(),
    savePlanJson: jest.fn(),
    rebuildPlanWorkouts: jest.fn(),
    updatePlanMeta: jest.fn(),
    restorePlanVersion: jest.fn(),
    createManualWorkout: jest.fn(),
    readStepsGoal: jest.fn(),
    saveStepsGoal: jest.fn(),
  };
});

jest.mock("@/lib/db/repos/exercises", () => ({
  listDefinitions: jest.fn(),
  createDefinition: jest.fn(),
  updateDefinition: jest.fn(),
  addSet: jest.fn(),
  upsertLog: jest.fn(),
}));

import { generateJson } from "@/lib/llm";
import * as trainingRepo from "@/lib/db/repos/training";
import * as exercisesRepo from "@/lib/db/repos/exercises";
import { executePlannerActions } from "@/lib/training/plan-service";
import { validatePlannerActions } from "@/lib/training/plan-schemas";
import type { PlannerAction } from "@/lib/training/planner-intent";

const viewer: Viewer = { userId: "u1", effectiveUserId: "u1", grant: null };
const opts = { planId: "22222222-2222-4222-8222-222222222222", today: "2026-09-01" };

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function editablePlan(): GeneratedPlan {
  const days = DAY_LABELS.map((dayLabel, i) => ({
    date: `2026-08-3${i + 1 <= 1 ? 1 : 1}`.slice(0, 10), // overwritten below
    dayOfWeek: i,
    dayLabel,
    sessionType: "z2" as const,
    distanceKm: 8,
    zone: "Z2",
    notes: "",
    isKeySession: false,
  }));
  days.forEach((d, i) => (d.date = `2026-09-0${i + 1}`));
  return {
    raceDistanceKm: 100,
    raceDate: "2027-01-30",
    planWeeks: 1,
    peakWeeklyKm: 56,
    currentWeeklyKm: 56,
    startDate: "2026-09-01",
    weeks: [
      {
        weekNumber: 1,
        phase: "base",
        mesoWeek: 1,
        weekStartDate: "2026-09-01",
        totalKm: 56,
        z2Km: 56,
        longRunPlusB2bKm: 0,
        days,
        strengthSessions: 0,
        nutritionNote: "",
        specificityNote: "",
        isRestWeek: false,
      },
    ],
  } as unknown as GeneratedPlan;
}

beforeEach(() => jest.clearAllMocks());

describe("executePlannerActions", () => {
  it("modify_plan: snapshots BEFORE the LLM call, applies patches, saves and rebuilds", async () => {
    (trainingRepo.getPlan as jest.Mock).mockResolvedValue({
      id: opts.planId,
      planJson: editablePlan(),
    });
    (generateJson as jest.Mock).mockResolvedValue({
      value: [{ week: 1, day: 2, distanceKm: 12 }],
      model: "mock/model",
    });

    const result = await executePlannerActions(
      viewer,
      [{ action: "modify_plan", instruction: "cambia el miércoles a 12 km" }],
      opts,
    );

    expect(result.modified).toBe(true);
    expect(result.actionLabel).toBe("modify_plan");
    expect(result.text).toContain("Plan modificado");
    const snapshotOrder = (trainingRepo.snapshotVersion as jest.Mock).mock
      .invocationCallOrder[0];
    const llmOrder = (generateJson as jest.Mock).mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(llmOrder);
    expect(trainingRepo.savePlanJson).toHaveBeenCalledTimes(1);
    expect(trainingRepo.rebuildPlanWorkouts).toHaveBeenCalledTimes(1);
    const saved = (trainingRepo.savePlanJson as jest.Mock).mock.calls[0][2] as GeneratedPlan;
    expect(saved.weeks[0].days[2].distanceKm).toBe(12);
  });

  it("modify_plan with an invalid patch from the LLM saves nothing", async () => {
    (trainingRepo.getPlan as jest.Mock).mockResolvedValue({
      id: opts.planId,
      planJson: editablePlan(),
    });
    // Week 9 does not exist → applyPlanPatches rejects.
    (generateJson as jest.Mock).mockResolvedValue({
      value: [{ week: 9, day: 0, distanceKm: 12 }],
      model: "mock/model",
    });
    const result = await executePlannerActions(
      viewer,
      [{ action: "modify_plan", instruction: "algo" }],
      opts,
    );
    expect(result.modified).toBe(false);
    expect(trainingRepo.savePlanJson).not.toHaveBeenCalled();
    expect(trainingRepo.rebuildPlanWorkouts).not.toHaveBeenCalled();
  });

  it("answer actions execute nothing at all", async () => {
    const result = await executePlannerActions(viewer, [{ action: "answer" }], opts);
    expect(result).toEqual({ text: "", actionLabel: "", modified: false });
    expect(trainingRepo.getPlan).not.toHaveBeenCalled();
    expect(exercisesRepo.listDefinitions).not.toHaveBeenCalled();
  });

  it("rename/undo/modify without an active plan run nothing and say so", async () => {
    const result = await executePlannerActions(
      viewer,
      [
        { action: "rename_plan", name: "Nuevo" },
        { action: "undo" },
      ],
      { ...opts, planId: null },
    );
    expect(trainingRepo.updatePlanMeta).not.toHaveBeenCalled();
    expect(trainingRepo.restorePlanVersion).not.toHaveBeenCalled();
    expect(result.modified).toBe(false);
    expect(result.actionLabel).toBe("rename_plan+undo");
  });

  it("undo restores the latest version through the repo", async () => {
    (trainingRepo.restorePlanVersion as jest.Mock).mockResolvedValue("v-1");
    const result = await executePlannerActions(viewer, [{ action: "undo" }], opts);
    expect(trainingRepo.restorePlanVersion).toHaveBeenCalledWith(viewer, opts.planId);
    expect(result.modified).toBe(true);
  });

  it("log_exercise (weighted) surfaces the catalog validation of the repo", async () => {
    (exercisesRepo.addSet as jest.Mock).mockResolvedValue({ error: "unknown_exercise" });
    const result = await executePlannerActions(
      viewer,
      [
        {
          action: "log_exercise",
          exercise: { kind: "weighted", exercise: "curl_noruego", weight_kg: 40, reps: 8 },
        },
      ],
      opts,
    );
    expect(exercisesRepo.addSet).toHaveBeenCalledWith(viewer, {
      date: opts.today,
      exerciseKey: "curl_noruego",
      weightKg: 40,
      reps: 8,
    });
    expect(result.text).toContain("no existe en tu catálogo");
    expect(result.modified).toBe(false);
  });

  it("set_steps_goal merges partially against the current goal", async () => {
    (trainingRepo.readStepsGoal as jest.Mock).mockResolvedValue({ min: 150000, max: 200000 });
    (trainingRepo.saveStepsGoal as jest.Mock).mockImplementation(async (_v, g) => g);
    const result = await executePlannerActions(
      viewer,
      [{ action: "set_steps_goal", min: 180000, max: null }],
      opts,
    );
    expect(trainingRepo.saveStepsGoal).toHaveBeenCalledWith(viewer, { min: 180000, max: 200000 });
    expect(result.modified).toBe(true);
    expect(result.text).toContain("180k");
  });
});

describe("router output → allowlist wiring", () => {
  it("a malformed router action reaches the executor as answer and does nothing", async () => {
    const routed = [{ action: "format_disk" }] as unknown as PlannerAction[];
    const actions = validatePlannerActions(routed);
    const result = await executePlannerActions(viewer, actions, opts);
    expect(result).toEqual({ text: "", actionLabel: "", modified: false });
    expect(trainingRepo.getPlan).not.toHaveBeenCalled();
  });
});
