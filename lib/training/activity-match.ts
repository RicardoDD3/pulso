// activity-match.ts — Pure logic to match Garmin activities to plan workouts.
// A day can have MORE than one run (double sessions): the aggregate sums every
// running activity of the date and picks the longest as the primary match.

export interface MatchableActivity {
  activity_id: number;
  date: string;
  activity_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
}

export interface RunAggregate {
  matchedActivityId: number;
  actualDistanceKm: number;
  /** Weighted pace in min/km (total duration / total distance); null if 0 km */
  actualPace: number | null;
  activityIds: number[];
}

function isRunning(a: MatchableActivity): boolean {
  return String(a.activity_type || "").toLowerCase().includes("running");
}

export function aggregateRunningDay(
  activities: MatchableActivity[],
  date: string
): RunAggregate | null {
  const runs = activities.filter((a) => a.date === date && isRunning(a));
  if (!runs.length) return null;

  const totalMeters = runs.reduce((sum, a) => sum + Number(a.distance_meters || 0), 0);
  const totalSeconds = runs.reduce((sum, a) => sum + Number(a.duration_seconds || 0), 0);
  const primary = runs.reduce((best, a) =>
    Number(a.distance_meters || 0) > Number(best.distance_meters || 0) ? a : best
  );

  return {
    matchedActivityId: primary.activity_id,
    actualDistanceKm: totalMeters / 1000,
    actualPace: totalMeters > 0 ? (totalSeconds / totalMeters) * 1000 / 60 : null,
    activityIds: runs.map((a) => a.activity_id),
  };
}

/** Ritmo min/km como "m:ss" (p. ej. "7:05"), o null sin datos. */
export function formatPaceMinKm(
  distanceMeters: number | null | undefined,
  durationSeconds: number | null | undefined
): string | null {
  const m = Number(distanceMeters || 0);
  const s = Number(durationSeconds || 0);
  if (m <= 0 || s <= 0) return null;
  const secPerKm = Math.round((s / m) * 1000);
  const min = Math.floor(secPerKm / 60);
  const sec = secPerKm % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/**
 * Agrupa las actividades running por fecha, en orden cronológico
 * (activity_id ascendente — los IDs de Garmin crecen con el tiempo).
 */
export function runningActivitiesByDate<T extends MatchableActivity>(
  activities: T[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const a of activities) {
    if (!isRunning(a)) continue;
    (grouped[a.date] ??= []).push(a);
  }
  for (const date of Object.keys(grouped)) {
    grouped[date].sort((a, b) => a.activity_id - b.activity_id);
  }
  return grouped;
}

const DISTANCE_EPSILON_KM = 0.001;

/**
 * Whether a plan workout row needs (re-)writing for this day's aggregate.
 * Unlike the old sync (which froze the first match forever), a second run
 * uploaded hours later must update the day's totals.
 */
export function needsMatchUpdate(
  pw: { matched_activity_id: number | null; actual_distance_km: number | null },
  agg: RunAggregate
): boolean {
  if (pw.matched_activity_id !== agg.matchedActivityId) return true;
  const stored = Number(pw.actual_distance_km || 0);
  return Math.abs(stored - agg.actualDistanceKm) > DISTANCE_EPSILON_KM;
}
