import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { getFeatures } from "@/lib/system/features";
import { generateJson, QuotaExceededError } from "@/lib/llm";
import * as trainingRepo from "@/lib/db/repos/training";
import * as healthRepo from "@/lib/db/repos/health";
import * as labsRepo from "@/lib/db/repos/labs";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { todayInTz } from "@/lib/health/tz";
import { generateTrainingPlan } from "@/lib/training/plan-generator";
import { applyDefaultStrengthDays } from "@/lib/training/week-tracks";
import { getDefaultPeakKm } from "@/lib/training/plan-static-data";
import {
  buildTrainingContext,
  formatRunningProfile,
  formatRecoveryProfile,
  formatEnduranceBiomarkers,
  buildTrainingPlanPrompt,
} from "@/lib/training/plan-prompt";
import { buildRecentActivitiesDetailText } from "@/lib/health/recent-activities-detail";
import { toTrainingActivity } from "@/lib/training/adapter";
import { PlanDataSchema } from "@/lib/training/plan-schemas";
import type { GeneratedPlan, PlanInputs } from "@/lib/training/plan-generator-types";
import type { PlanData } from "@/lib/training/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/training/plans — the user's plans, newest first. */
export const GET = withApi(async (req) => {
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const plans = await trainingRepo.listPlans(viewer);
  return ok({ plans });
});

const deterministicSchema = z.object({
  generator: z.literal("deterministic"),
  raceDistanceKm: z.number().min(1).max(500),
  raceDate: z.string().regex(DATE),
  planWeeks: z.number().int().min(4).max(40).optional(),
  peakWeeklyKm: z.number().min(1).max(400).optional(),
  currentWeeklyKm: z.number().min(1).max(400),
  daysPerWeek: z.union([z.literal(5), z.literal(6), z.literal(7)]).optional(),
  longRunDay: z.enum(["saturday", "sunday"]).optional(),
  hasBackToBack: z.boolean().optional(),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  name: z.string().min(1).max(120).optional(),
  terrain: z.string().min(1).max(40).optional(),
});

const aiSchema = z.object({
  generator: z.literal("ai").optional(),
  name: z.string().min(1).max(120),
  goal_type: z.string().min(1).max(40),
  goal_date: z.string().regex(DATE),
  goal_time: z.string().max(40).optional(),
  goal_distance_km: z.number().positive().max(500).optional(),
  available_days: z.number().int().min(1).max(7),
  terrain: z.string().min(1).max(40),
  model: z.string().max(80).optional(),
});

function goalTypeFor(raceDistanceKm: number): string {
  if (raceDistanceKm <= 25) return "half_marathon";
  if (raceDistanceKm <= 45) return "marathon";
  return "ultra";
}

/**
 * POST /api/training/plans — create a plan.
 * `generator: "deterministic"` → pure generator, works WITHOUT any LLM.
 * Otherwise → AI generation (requires aiPlansEnabled), PlanData validated
 * with Zod before anything touches the DB.
 */
export const POST = withApi(async (req) => {
  const owner = requireOwner(await resolveViewer());
  const body = (await req.json()) as Record<string, unknown>;

  if (body?.generator === "deterministic") {
    const input = deterministicSchema.parse(body);
    const inputs: PlanInputs = {
      raceDistanceKm: input.raceDistanceKm,
      raceDate: input.raceDate,
      planWeeks: input.planWeeks ?? 24,
      peakWeeklyKm: input.peakWeeklyKm ?? getDefaultPeakKm(input.raceDistanceKm),
      currentWeeklyKm: input.currentWeeklyKm,
      daysPerWeek: input.daysPerWeek ?? 6,
      longRunDay: input.longRunDay ?? "saturday",
      hasBackToBack: input.hasBackToBack ?? true,
      experienceLevel: input.experienceLevel ?? "intermediate",
    };
    let generated: GeneratedPlan;
    try {
      generated = generateTrainingPlan(inputs);
    } catch {
      return apiError(400, "invalid_input");
    }
    applyDefaultStrengthDays(generated);

    const plan = await trainingRepo.createPlan(owner, {
      name: input.name ?? `${input.raceDistanceKm}km Plan`,
      goalType: goalTypeFor(input.raceDistanceKm),
      goalDate: input.raceDate,
      goalDistanceKm: input.raceDistanceKm,
      availableDays: inputs.daysPerWeek,
      terrain: input.terrain ?? "trail",
      planJson: generated,
      llmUsed: "deterministic",
    });
    await trainingRepo.insertPlanWorkouts(
      owner,
      plan.id,
      trainingRepo.planWorkoutSeedsFromGeneratedPlan(plan.planJson as GeneratedPlan),
    );
    return ok({ plan });
  }

  if (!getFeatures().aiPlansEnabled) return apiError(400, "feature_disabled");
  const goal = aiSchema.parse(body);

  const profile = await profilesRepo.getProfile(owner);
  const today = todayInTz(profile.timezone || "UTC");
  const from = new Date(Date.now() - 90 * 24 * 3600_000).toISOString().split("T")[0];

  const [workoutRows, healthDayRows, sleepRows, labSessions] = await Promise.all([
    healthRepo.workoutsRange(owner, from, today, { limit: 500 }),
    healthRepo.healthDaysRange(owner, from, today),
    healthRepo.sleepRange(owner, from, today),
    labsRepo.listSessions(owner, 1),
  ]);
  const labSession = labSessions[0] ?? null;
  const labResultRows = labSession ? await labsRepo.sessionResults(owner, labSession.id) : [];

  // Adapt canonical rows to the Garmin-era shapes the ported formatters read.
  const activities = workoutRows
    .slice()
    .reverse()
    .map((w) => toTrainingActivity(w) as unknown as Record<string, unknown>);
  const ctx = buildTrainingContext({
    activities,
    summaries: healthDayRows.map((d) => ({
      date: d.date,
      resting_hr: d.restingHr,
      hrv_weekly_avg: d.hrvMs,
      avg_stress: d.stressAvg,
      body_battery_high: d.bodyBatteryHigh,
    })),
    sleepData: sleepRows.map((s) => ({
      date: s.endAt.toISOString().split("T")[0],
      sleep_seconds: s.totalMin != null ? s.totalMin * 60 : null,
      sleep_score: s.score,
    })),
    bodyCompRows: null,
    labSessionRows: labSession ? [{ sample_date: labSession.sampleDate }] : null,
    labResults: labResultRows.map((r) => ({
      test_name: r.testName,
      test_name_normalized: r.testNameNormalized,
      result: r.valueNum,
      result_text: r.valueText,
      unit: r.unit,
      reference_min: r.refLow,
      reference_max: r.refHigh,
      is_flagged: r.isFlagged,
    })),
    recentActivitiesDetail: buildRecentActivitiesDetailText(activities, [], [], 15),
  });

  const prompt = buildTrainingPlanPrompt(
    formatRunningProfile(ctx.activities),
    formatRecoveryProfile(ctx.summaries, ctx.sleepData),
    formatEnduranceBiomarkers(ctx.labResults, ctx.labDate ? String(ctx.labDate) : null),
    {
      goal_type: goal.goal_type,
      goal_date: goal.goal_date,
      goal_time: goal.goal_time,
      goal_distance_km: goal.goal_distance_km,
      available_days: goal.available_days,
      terrain: goal.terrain,
    },
    ctx.recentActivitiesDetail,
  );

  let planData: PlanData;
  let modelUsed: string;
  try {
    const result = await generateJson({
      feature: "plan_generation",
      viewer: owner,
      model: goal.model,
      system: "Eres un entrenador experto. Responde SOLO con JSON valido, sin markdown.",
      messages: [{ role: "user", content: prompt }],
      schema: PlanDataSchema,
    });
    planData = result.value as PlanData;
    modelUsed = result.model;
  } catch (err) {
    if (err instanceof QuotaExceededError) return apiError(429, "quota_exceeded");
    return apiError(502, "llm_failed");
  }

  const plan = await trainingRepo.createPlan(owner, {
    name: goal.name,
    goalType: goal.goal_type,
    goalDate: goal.goal_date,
    goalTime: goal.goal_time ?? null,
    goalDistanceKm: goal.goal_distance_km ?? null,
    availableDays: goal.available_days,
    terrain: goal.terrain,
    planJson: planData,
    llmUsed: modelUsed,
  });
  await trainingRepo.insertPlanWorkouts(
    owner,
    plan.id,
    trainingRepo.planWorkoutSeedsFromPlanData(planData),
  );
  return ok({ plan });
});
