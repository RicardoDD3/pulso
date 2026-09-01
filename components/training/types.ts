/**
 * View-model types for the Training UI — mirrors of the API row shapes
 * (lib/db/repos/training.ts) as serialized over JSON by the routes.
 */

export type PlanSummary = {
  id: string;
  name: string;
  goalType: string | null;
  goalDate: string | null;
  goalTime: string | null;
  goalDistanceKm: number | null;
  status: string;
  llmUsed: string | null;
  createdAt: string;
};

export type PlanRow = PlanSummary & {
  terrain: string | null;
  planJson: unknown;
  updatedAt: string;
};

export type PlanWorkoutRow = {
  id: string;
  planId: string;
  weekNumber: number;
  dayOfWeek: number;
  date: string | null;
  workoutType: string;
  title: string | null;
  targetDistanceKm: number | null;
  targetPaceRange: string | null;
  targetHrZone: string | null;
  matchedWorkoutId: string | null;
  matchedManualId: string | null;
  status: string;
  actualDistanceKm: number | null;
  actualPace: number | string | null;
};

export type PlanVersion = {
  id: string;
  label: string | null;
  createdAt: string;
};

export const RUN_TYPES = new Set([
  "easy_run",
  "long_run",
  "tempo",
  "intervals",
  "recovery_run",
]);

/**
 * Weekly target km from plan_json, tolerant of both stored shapes:
 * GeneratedPlan weeks ({weekNumber, targetKm/totalKm}) and LLM PlanData
 * weeks ({week_number, target_km}).
 */
export function weekTargetKm(planJson: unknown, weekNumber: number): number | null {
  const weeks = (planJson as { weeks?: unknown[] } | null)?.weeks;
  if (!Array.isArray(weeks)) return null;
  for (const raw of weeks) {
    const w = raw as {
      weekNumber?: number;
      week_number?: number;
      targetKm?: number;
      totalKm?: number;
      target_km?: number;
    };
    if ((w.weekNumber ?? w.week_number) === weekNumber) {
      return w.targetKm ?? w.totalKm ?? w.target_km ?? null;
    }
  }
  return null;
}

export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
