// Series puras para las tendencias nuevas de TrendsTab a partir de las carreras
// (activities con columnas nuevas) y el clima. Ritmos en min/km DECIMAL para las
// gráficas (no "m:ss"). Todo input→output, null-safe.

import { toNum } from "./activity-detail";
import { fToC } from "./weather";

export interface TrendActivity {
  date?: string | null;
  activity_id?: number | string | null;
  distance_meters?: number | string | null;
  duration_seconds?: number | string | null;
  avg_hr?: number | string | null;
  aerobic_training_effect?: number | string | null;
  anaerobic_training_effect?: number | string | null;
  avg_grade_adjusted_speed_mps?: number | string | null;
  raw_summary?: { activityTrainingLoad?: number | string | null } | null;
}

/** Ritmo min/km decimal (para ejes de gráfica), o null. */
export function paceMinKmNum(distanceMeters: unknown, durationSeconds: unknown): number | null {
  const m = toNum(distanceMeters);
  const s = toNum(durationSeconds);
  if (m === null || s === null || m <= 0 || s <= 0) return null;
  return s / 60 / (m / 1000);
}

/** Ritmo GAP min/km decimal desde m/s, o null. */
export function gapPaceMinKmNum(mps: unknown): number | null {
  const v = toNum(mps);
  if (v === null || v <= 0) return null;
  return 1000 / v / 60;
}

export interface TEPoint {
  date: string;
  aerobic: number | null;
  anaerobic: number | null;
}

export function buildTrainingEffectSeries(activities: TrendActivity[]): TEPoint[] {
  const out: TEPoint[] = [];
  for (const a of activities) {
    if (!a.date) continue;
    const aerobic = toNum(a.aerobic_training_effect);
    const anaerobic = toNum(a.anaerobic_training_effect);
    if (aerobic === null && anaerobic === null) continue;
    out.push({ date: String(a.date), aerobic, anaerobic });
  }
  return out;
}

export interface LoadPoint {
  date: string;
  load: number;
}

export function buildTrainingLoadSeries(activities: TrendActivity[]): LoadPoint[] {
  const out: LoadPoint[] = [];
  for (const a of activities) {
    const load = toNum(a.raw_summary?.activityTrainingLoad);
    if (a.date && load !== null) out.push({ date: String(a.date), load });
  }
  return out;
}

export interface GapPoint {
  date: string;
  gapPace: number | null;
  realPace: number | null;
}

export function buildGapSeries(activities: TrendActivity[]): GapPoint[] {
  const out: GapPoint[] = [];
  for (const a of activities) {
    const gapPace = gapPaceMinKmNum(a.avg_grade_adjusted_speed_mps);
    if (a.date && gapPace !== null) {
      out.push({
        date: String(a.date),
        gapPace,
        realPace: paceMinKmNum(a.distance_meters, a.duration_seconds),
      });
    }
  }
  return out;
}

export interface WeatherRow {
  activity_id?: number | string | null;
  temp?: number | string | null;
  relative_humidity?: number | string | null;
}

export interface WeatherPerfPoint {
  date: string;
  tempC: number;
  pace: number;
  hr: number | null;
  humidity: number | null;
}

/** Une carreras con su clima por activity_id → puntos temp(°C) vs ritmo. */
export function pairWeatherPerformance(
  runs: TrendActivity[],
  weather: WeatherRow[]
): WeatherPerfPoint[] {
  const byId = new Map<number, WeatherRow>();
  for (const w of weather) {
    const id = toNum(w.activity_id);
    if (id !== null) byId.set(id, w);
  }
  const out: WeatherPerfPoint[] = [];
  for (const r of runs) {
    const id = toNum(r.activity_id);
    if (id === null) continue;
    const w = byId.get(id);
    if (!w) continue;
    const tempC = fToC(w.temp);
    const pace = paceMinKmNum(r.distance_meters, r.duration_seconds);
    if (tempC === null || pace === null || !r.date) continue;
    out.push({
      date: String(r.date),
      tempC,
      pace,
      hr: toNum(r.avg_hr),
      humidity: toNum(w.relative_humidity),
    });
  }
  return out;
}
