/**
 * Estadísticas descriptivas sobre series Garmin (fuente única para los
 * prompts de los chats y la generación de planes). Todo puro y determinístico:
 * media, percentiles (interpolación lineal), picos con fecha y σ poblacional.
 */

export interface MetricStats {
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MetricStatsWithDates extends MetricStats {
  minDate: string;
  maxDate: string;
}

/** Percentil p (0..1) por interpolación lineal (índice (n-1)*p). Requiere array ordenado ascendente y no vacío. */
export function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const frac = idx - lo;
  if (frac === 0) return sorted[lo];
  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
}

/** Estadísticas de una serie; ignora nulls/NaN (el 0 sí es un valor). Null si no queda ningún valor. */
export function computeStats(values: Array<number | null | undefined>): MetricStats | null {
  const vals = values.filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (!vals.length) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

  return {
    n,
    mean,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}

/** Como computeStats, pero con la fecha del mínimo y del pico (ante empate gana la más reciente). */
export function computeStatsWithDates<T>(
  rows: T[],
  getValue: (row: T) => number | null | undefined,
  getDate: (row: T) => string
): MetricStatsWithDates | null {
  const pairs = rows
    .map((r) => ({ v: getValue(r), d: getDate(r) }))
    .filter((p): p is { v: number; d: string } => typeof p.v === "number" && !isNaN(p.v));
  if (!pairs.length) return null;

  const stats = computeStats(pairs.map((p) => p.v))!;
  let minDate = "";
  let maxDate = "";
  for (const p of pairs) {
    if (p.v === stats.min && p.d >= minDate) minDate = p.d;
    if (p.v === stats.max && p.d >= maxDate) maxDate = p.d;
  }
  return { ...stats, minDate, maxDate };
}

/** Minutos decimales como "m:ss", acarreando segundos (5.9983 → "6:00", nunca "5:60"). */
export function formatMinSec(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

export interface StatsLineOptions {
  decimals?: number;
  /** Unidad pegada a cada valor ("h" → "7.5h"). Ignorada si hay fmt. */
  unit?: string;
  /** Formateador custom de valores (p. ej. formatMinSec para ritmos). */
  fmt?: (v: number) => string;
  minLabel?: string;
  maxLabel?: string;
}

/** Línea canónica en español para los prompts: media | p50 | p25–p75 | p10–p90 | mín | máx | σ | n. */
export function formatStatsLine(
  stats: MetricStats | MetricStatsWithDates,
  opts: StatsLineOptions = {}
): string {
  const { decimals = 0, unit = "", fmt, minLabel = "mín", maxLabel = "máx" } = opts;
  const f = fmt ?? ((v: number) => `${v.toFixed(decimals)}${unit}`);
  const minDate = "minDate" in stats && stats.minDate ? ` (${stats.minDate})` : "";
  const maxDate = "maxDate" in stats && stats.maxDate ? ` (${stats.maxDate})` : "";
  return (
    `media ${f(stats.mean)} | p50 ${f(stats.p50)} | ` +
    `p25–p75 ${f(stats.p25)}–${f(stats.p75)} | p10–p90 ${f(stats.p10)}–${f(stats.p90)} | ` +
    `${minLabel} ${f(stats.min)}${minDate} | ${maxLabel} ${f(stats.max)}${maxDate} | ` +
    `σ ${f(stats.std)} | n ${stats.n}`
  );
}
