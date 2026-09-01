/**
 * FIT ↔ workout matching rule (spec doc 03): start time within ±5 minutes AND,
 * when both sides report a distance, within 10% of each other. Nearest start
 * wins ties. Pure — candidates come from lib/db/repos/health.workoutsNear.
 */
import type { WorkoutRow } from "@/lib/db/schema";
import type { ParsedFit } from "@/lib/fit/parse";

export const MATCH_WINDOW_MS = 5 * 60_000;
export const MATCH_DISTANCE_TOLERANCE = 0.1;

export function matchWorkout(parsed: ParsedFit, candidates: WorkoutRow[]): WorkoutRow | null {
  const startTime = parsed.session?.startTime ?? null;
  if (!startTime) return null;
  const fitDistanceM = parsed.session?.totalDistanceM ?? null;

  let best: WorkoutRow | null = null;
  let bestDiffMs = Infinity;
  for (const workout of candidates) {
    const diffMs = Math.abs(workout.startAt.getTime() - startTime.getTime());
    if (diffMs > MATCH_WINDOW_MS) continue;
    if (fitDistanceM !== null && workout.distanceM !== null) {
      const tolerance = MATCH_DISTANCE_TOLERANCE * Math.max(fitDistanceM, workout.distanceM);
      if (Math.abs(fitDistanceM - workout.distanceM) > tolerance) continue;
    }
    if (diffMs < bestDiffMs) {
      bestDiffMs = diffMs;
      best = workout;
    }
  }
  return best;
}
