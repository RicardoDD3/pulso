// Transformaciones puras para el detalle de una carrera (vueltas, parciales y
// métricas de esfuerzo) y para el badge de esfuerzo de la ActivityCard. Todo
// input→output determinístico, tolerando strings de PostgREST y filas
// incompletas (una carrera vieja sin `raw_summary` cae a null en todo).

/** Coerción segura a número: null/""/NaN → null; el 0 es un valor válido. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** "SNAKE_CASE" → "Snake case" (fallback de etiquetas desconocidas). */
function prettySnake(s: string): string {
  const lower = s.toLowerCase().replace(/_/g, " ").trim();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : "";
}

/**
 * URL del detalle de una actividad. `viewUserParam` llega como "&viewUser=..."
 * (formato para pegarlo tras un query existente), pero esta ruta NO tiene otro
 * query param, así que hay que anteponer "?" — pegar el "&" directo deja la URL
 * malformada (`/activity/123&viewUser=x`) y el server no ve el viewUser, cayendo
 * al usuario actual (que puede no tener datos → detalle vacío).
 */
export function activityDetailUrl(activityId: number | string, viewUserParam = ""): string {
  const base = `/api/garmin/activity/${activityId}`;
  const clean = viewUserParam.replace(/^[?&]+/, "");
  return clean ? `${base}?${clean}` : base;
}

/** m/s → ritmo "m:ss" por km, o null sin velocidad válida. */
export function speedMpsToPaceMinKm(mps: unknown): string | null {
  const v = toNum(mps);
  if (v === null || v <= 0) return null;
  const secPerKm = Math.round(1000 / v);
  const min = Math.floor(secPerKm / 60);
  const sec = secPerKm % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// --- Etiquetas ---

export const INTENSITY_LABELS: Record<string, string> = {
  INTERVAL: "Intervalo",
  ACTIVE: "Activo",
  WARMUP: "Calent.",
  COOLDOWN: "Enfr.",
  REST: "Recup.",
  RECOVERY: "Recup.",
};

export function intensityLabelEs(t: unknown): string {
  const key = String(t ?? "").toUpperCase();
  return INTENSITY_LABELS[key] || "—";
}

export const SPLIT_TYPE_LABELS: Record<string, string> = {
  RWD_RUN: "Corriendo",
  RWD_WALK: "Caminando",
  RWD_STAND: "Parado",
  INTERVAL_ACTIVE: "Activo",
  INTERVAL_RECOVERY: "Recuperación",
  INTERVAL_WARMUP: "Calentamiento",
  INTERVAL_COOLDOWN: "Enfriamiento",
  INTERVAL_REST: "Descanso",
  PACE_PRO_SPLIT: "PacePro",
};

export function splitTypeLabelEs(t: unknown): string {
  const key = String(t ?? "").toUpperCase();
  return SPLIT_TYPE_LABELS[key] || prettySnake(key) || "—";
}

export const TE_LABEL_ES: Record<string, string> = {
  NONE: "—",
  RECOVERY: "Recuperación",
  AEROBIC_BASE: "Base aeróbica",
  TEMPO: "Tempo",
  LACTATE_THRESHOLD: "Umbral láctico",
  VO2MAX: "VO2máx",
  ANAEROBIC_CAPACITY: "Cap. anaeróbica",
};

export function teLabelEs(label: unknown): string | null {
  if (label === null || label === undefined || label === "") return null;
  const key = String(label).toUpperCase();
  return TE_LABEL_ES[key] || prettySnake(key);
}

// --- Vueltas (activity_laps) ---

export interface RawLap {
  lap_index?: number | string | null;
  intensity_type?: string | null;
  distance_meters?: number | string | null;
  duration_seconds?: number | string | null;
  avg_hr?: number | string | null;
  max_hr?: number | string | null;
  avg_run_cadence_spm?: number | string | null;
  avg_power_w?: number | string | null;
  stride_length_cm?: number | string | null;
  vertical_oscillation_cm?: number | string | null;
  vertical_ratio?: number | string | null;
  ground_contact_time_ms?: number | string | null;
  elevation_gain_m?: number | string | null;
  elevation_loss_m?: number | string | null;
}

export interface NormalizedLap {
  index: number;
  intensity: string;
  km: number | null;
  durationSec: number | null;
  paceMinKm: string | null;
  avgHr: number | null;
  maxHr: number | null;
  cadence: number | null;
  powerW: number | null;
  strideCm: number | null;
  vertOscCm: number | null;
  vertRatio: number | null;
  gctMs: number | null;
  elevGain: number | null;
  elevLoss: number | null;
}

export function normalizeLap(row: RawLap): NormalizedLap {
  const dist = toNum(row.distance_meters);
  const dur = toNum(row.duration_seconds);
  return {
    index: toNum(row.lap_index) ?? 0,
    intensity: intensityLabelEs(row.intensity_type),
    km: dist === null ? null : dist / 1000,
    durationSec: dur,
    paceMinKm: dist && dur && dist > 0 && dur > 0 ? speedMpsToPaceMinKm(dist / dur) : null,
    avgHr: toNum(row.avg_hr),
    maxHr: toNum(row.max_hr),
    cadence: toNum(row.avg_run_cadence_spm),
    powerW: toNum(row.avg_power_w),
    strideCm: toNum(row.stride_length_cm),
    vertOscCm: toNum(row.vertical_oscillation_cm),
    vertRatio: toNum(row.vertical_ratio),
    gctMs: toNum(row.ground_contact_time_ms),
    elevGain: toNum(row.elevation_gain_m),
    elevLoss: toNum(row.elevation_loss_m),
  };
}

// --- Resumen de parciales (raw_summary.splitSummaries) ---

export interface RawSplitSummary {
  splitType?: string | null;
  distance?: number | string | null;
  duration?: number | string | null;
  averageSpeed?: number | string | null;
  noOfSplits?: number | string | null;
}

export interface SplitSummary {
  type: string;
  label: string;
  km: number | null;
  durationSec: number | null;
  paceMinKm: string | null;
  count: number | null;
}

export function summarizeSplits(splitSummaries: unknown): SplitSummary[] {
  if (!Array.isArray(splitSummaries)) return [];
  return splitSummaries.map((s: RawSplitSummary) => {
    const dist = toNum(s.distance);
    const dur = toNum(s.duration);
    const pace =
      dist && dur && dist > 0 && dur > 0
        ? speedMpsToPaceMinKm(dist / dur)
        : speedMpsToPaceMinKm(s.averageSpeed);
    return {
      type: String(s.splitType ?? ""),
      label: splitTypeLabelEs(s.splitType),
      km: dist === null ? null : dist / 1000,
      durationSec: dur,
      paceMinKm: pace,
      count: toNum(s.noOfSplits),
    };
  });
}

// --- Métricas de esfuerzo (nivel actividad) ---

export interface RawSummaryLike {
  activityTrainingLoad?: number | string | null;
  trainingEffectLabel?: string | null;
  hrTimeInZone_1?: number | string | null;
  hrTimeInZone_2?: number | string | null;
  hrTimeInZone_3?: number | string | null;
  hrTimeInZone_4?: number | string | null;
  hrTimeInZone_5?: number | string | null;
}

export interface EffortActivity {
  aerobic_training_effect?: number | string | null;
  anaerobic_training_effect?: number | string | null;
  training_load?: number | string | null;
  avg_grade_adjusted_speed_mps?: number | string | null;
  moving_duration_seconds?: number | string | null;
  elapsed_duration_seconds?: number | string | null;
  duration_seconds?: number | string | null;
  raw_summary?: RawSummaryLike | null;
}

export interface EffortMetrics {
  aerobicTE: number | null;
  anaerobicTE: number | null;
  trainingLoad: number | null;
  teLabel: string | null;
  teLabelEs: string | null;
  gapPaceMinKm: string | null;
  movingSec: number | null;
  elapsedSec: number | null;
  movingPct: number | null;
}

export function extractEffortMetrics(activity: EffortActivity): EffortMetrics {
  const rs: RawSummaryLike = activity.raw_summary || {};
  const trainingLoad = toNum(rs.activityTrainingLoad) ?? toNum(activity.training_load);
  const teLabel =
    rs.trainingEffectLabel !== null && rs.trainingEffectLabel !== undefined && rs.trainingEffectLabel !== ""
      ? String(rs.trainingEffectLabel)
      : null;
  const movingSec = toNum(activity.moving_duration_seconds);
  const elapsedSec = toNum(activity.elapsed_duration_seconds) ?? toNum(activity.duration_seconds);
  const movingPct =
    movingSec !== null && elapsedSec !== null && elapsedSec > 0 ? (movingSec / elapsedSec) * 100 : null;
  return {
    aerobicTE: toNum(activity.aerobic_training_effect),
    anaerobicTE: toNum(activity.anaerobic_training_effect),
    trainingLoad,
    teLabel,
    teLabelEs: teLabelEs(teLabel),
    gapPaceMinKm: speedMpsToPaceMinKm(activity.avg_grade_adjusted_speed_mps),
    movingSec,
    elapsedSec,
    movingPct,
  };
}

/** ¿La actividad trae alguna métrica de esfuerzo nueva? (badge + gate del acordeón) */
export function hasEffortData(activity: EffortActivity): boolean {
  const m = extractEffortMetrics(activity);
  return (
    m.aerobicTE !== null ||
    m.anaerobicTE !== null ||
    m.trainingLoad !== null ||
    m.gapPaceMinKm !== null
  );
}

// --- Zonas de FC (raw_summary.hrTimeInZone_1..5, en segundos) ---

export interface HrZone {
  zone: number;
  seconds: number;
  minutes: number;
  pct: number;
}

export function parseHrZones(activity: EffortActivity): HrZone[] | null {
  const rs: RawSummaryLike = activity.raw_summary || {};
  const secs = [1, 2, 3, 4, 5].map(
    (z) => toNum(rs[`hrTimeInZone_${z}` as keyof RawSummaryLike]) ?? 0
  );
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return secs.map((s, i) => ({
    zone: i + 1,
    seconds: s,
    minutes: s / 60,
    pct: (s / total) * 100,
  }));
}
