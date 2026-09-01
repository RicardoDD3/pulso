// hr-intraday.ts — Análisis de la curva de FC intradía (heart_rate_samples,
// monitoreo diario a ~1 muestra c/2 min) para los prompts de los chats:
// encuentra la ventana del entrenamiento y la resume (máx muestreado, minutos
// sobre umbrales personalizados, curva completa en hora local).
//
// Límite conocido: estas muestras NO son la grabación de la actividad — el
// pico real de una carrera vive en activities.max_hr y una muestra cada 2 min
// no captura cada sprint individual.

export interface HrSample {
  timestamp_ms: number;
  heart_rate: number;
}

export interface ElevatedWindow {
  startMs: number;
  endMs: number;
  maxHr: number;
  samples: HrSample[];
}

/** FC mínima para considerar una muestra "en entrenamiento". */
export const ELEVATED_HR_THRESHOLD = 110;
/** Huecos tolerados entre muestras elevadas dentro de la misma ventana. */
export const WINDOW_MAX_GAP_MS = 8 * 60_000;
/** Permanencia máxima que puede aportar una muestra (gaps largos no inflan). */
export const DWELL_CAP_MS = 4 * 60_000;
/** Permanencia de la última muestra de una serie (cadencia típica: 2 min). */
export const DEFAULT_DWELL_MS = 2 * 60_000;

const byTime = (a: HrSample, b: HrSample) => a.timestamp_ms - b.timestamp_ms;

/** Bloque contiguo más largo de FC ≥ threshold (empate: el de más muestras). */
export function findElevatedWindow(
  samples: HrSample[],
  threshold = ELEVATED_HR_THRESHOLD,
  maxGapMs = WINDOW_MAX_GAP_MS
): ElevatedWindow | null {
  const elevated = samples.filter((s) => Number(s.heart_rate) >= threshold).sort(byTime);
  if (!elevated.length) return null;

  const blocks: HrSample[][] = [];
  let current: HrSample[] = [elevated[0]];
  for (let i = 1; i < elevated.length; i++) {
    if (elevated[i].timestamp_ms - elevated[i - 1].timestamp_ms <= maxGapMs) {
      current.push(elevated[i]);
    } else {
      blocks.push(current);
      current = [elevated[i]];
    }
  }
  blocks.push(current);

  const spanOf = (b: HrSample[]) => b[b.length - 1].timestamp_ms - b[0].timestamp_ms;
  let best = blocks[0];
  for (const b of blocks.slice(1)) {
    if (spanOf(b) > spanOf(best) || (spanOf(b) === spanOf(best) && b.length > best.length)) best = b;
  }

  return {
    startMs: best[0].timestamp_ms,
    endMs: best[best.length - 1].timestamp_ms,
    maxHr: Math.max(...best.map((s) => s.heart_rate)),
    samples: best,
  };
}

/**
 * Minutos aproximados con FC ≥ bpm: cada muestra cuenta el gap hasta la
 * siguiente (tope DWELL_CAP_MS); la última cuenta DEFAULT_DWELL_MS.
 */
export function approxMinutesAbove(samples: HrSample[], bpm: number): number {
  const sorted = [...samples].sort(byTime);
  let ms = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (Number(sorted[i].heart_rate) < bpm) continue;
    ms +=
      i < sorted.length - 1
        ? Math.min(sorted[i + 1].timestamp_ms - sorted[i].timestamp_ms, DWELL_CAP_MS)
        : DEFAULT_DWELL_MS;
  }
  return Math.round(ms / 60_000);
}

/**
 * Línea del prompt para un día: ventana elevada en hora local, máx muestreado
 * con hora, minutos sobre el umbral base y los cortes personalizados (techo de
 * zona fácil / piso de zona de calidad), más la curva completa "HH:MM bpm".
 */
export function formatHrCurveDay(
  date: string,
  samples: HrSample[],
  cuts?: { easyMaxBpm?: number | null; qualityMinBpm?: number | null } | null,
  timeZone = "America/Mexico_City"
): string | null {
  const w = findElevatedWindow(samples);
  if (!w) return null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const t = (ms: number) => fmt.format(new Date(ms));
  const maxSample = w.samples.find((s) => s.heart_rate === w.maxHr)!;

  const parts = [
    `${date} | ventana elevada ${t(w.startMs)}–${t(w.endMs)}`,
    `máx muestra ${w.maxHr} (${t(maxSample.timestamp_ms)})`,
    `~${approxMinutesAbove(w.samples, ELEVATED_HR_THRESHOLD)} min ≥${ELEVATED_HR_THRESHOLD} bpm`,
  ];
  if (cuts?.easyMaxBpm) {
    parts.push(`~${approxMinutesAbove(w.samples, cuts.easyMaxBpm + 1)} min >${cuts.easyMaxBpm} bpm`);
  }
  if (cuts?.qualityMinBpm) {
    parts.push(`~${approxMinutesAbove(w.samples, cuts.qualityMinBpm)} min ≥${cuts.qualityMinBpm} bpm`);
  }

  const curve = w.samples.map((s) => `${t(s.timestamp_ms)} ${s.heart_rate}`).join(" · ");
  return `${parts.join(" | ")}\n    curva: ${curve}`;
}
