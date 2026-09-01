// VO2 max viene por actividad (Garmin lo re-estima en cada carrera), no en
// daily_summary — de ahí que la tendencia se derive de `activities.vo2max_value`.

export interface Vo2maxPoint {
  date: string;
  vo2max: number;
}

interface ActivityLike {
  date: string;
  vo2max_value?: number | null;
}

/** Un punto por fecha (la última actividad del día gana), orden ascendente. */
export function extractVo2maxTrend(activities: ActivityLike[]): Vo2maxPoint[] {
  const byDate = new Map<string, number>();
  for (const a of activities) {
    if (a.vo2max_value == null || !a.date) continue;
    byDate.set(a.date, Number(a.vo2max_value));
  }
  return [...byDate.entries()]
    .map(([date, vo2max]) => ({ date, vo2max }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Último VO2 max conocido, opcionalmente hasta una fecha (inclusive). */
export function latestVo2max(
  activities: ActivityLike[],
  upToDate?: string
): Vo2maxPoint | null {
  const trend = extractVo2maxTrend(activities).filter(
    (p) => !upToDate || p.date <= upToDate
  );
  return trend.length > 0 ? trend[trend.length - 1] : null;
}
