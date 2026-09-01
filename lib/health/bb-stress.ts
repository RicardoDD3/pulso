// bb-stress.ts — Resumen intradía de Body Battery y estrés para los prompts.
//
// Las tablas guardan ~480 muestras por día y tabla (una cada ~3 min): mandarlas
// crudas es inviable, pero el agregado diario (alto→bajo, promedio) no explica
// NADA de la forma del día. Este bloque comprime cada día a una línea con lo
// accionable: con qué batería arrancó y terminó, su pico/mínimo con hora, la
// mayor caída sostenida y cuánto tiempo pasó en estrés alto.

export interface LevelSample {
  timestamp_ms: number;
  level: number;
}

export interface DaySamples {
  battery?: LevelSample[];
  stress?: LevelSample[];
}

/** Estrés ≥ 76 es "alto" en la escala de Garmin (0-25 reposo, 26-50 bajo, 51-75 medio). */
export const HIGH_STRESS_THRESHOLD = 76;
/** Permanencia máxima que aporta una muestra (un hueco largo no infla los minutos). */
const DWELL_CAP_MS = 6 * 60_000;
/** Permanencia de la última muestra (cadencia típica: ~3 min). */
const DEFAULT_DWELL_MS = 3 * 60_000;

const byTime = (a: LevelSample, b: LevelSample) => a.timestamp_ms - b.timestamp_ms;

/** Minutos aproximados con nivel ≥ threshold, contando el hueco a la siguiente muestra. */
function approxMinutesAtOrAbove(samples: LevelSample[], threshold: number): number {
  const sorted = [...samples].sort(byTime);
  let ms = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].level < threshold) continue;
    ms +=
      i < sorted.length - 1
        ? Math.min(sorted[i + 1].timestamp_ms - sorted[i].timestamp_ms, DWELL_CAP_MS)
        : DEFAULT_DWELL_MS;
  }
  return Math.round(ms / 60_000);
}

/**
 * Mayor caída del día: la diferencia más grande entre un máximo y un mínimo
 * POSTERIOR (no un simple máx−mín, que podría ir al revés en el tiempo).
 */
function biggestDrop(sorted: LevelSample[]): { drop: number; from: LevelSample; to: LevelSample } | null {
  if (sorted.length < 2) return null;
  let peak = sorted[0];
  let best: { drop: number; from: LevelSample; to: LevelSample } | null = null;
  for (const s of sorted.slice(1)) {
    if (s.level > peak.level) {
      peak = s;
      continue;
    }
    const drop = peak.level - s.level;
    if (drop > 0 && (!best || drop > best.drop)) best = { drop, from: peak, to: s };
  }
  return best;
}

export function formatBodyBatteryStressBlock(
  byDate: Record<string, DaySamples>,
  timeZone = "America/Mexico_City"
): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const t = (ms: number) => fmt.format(new Date(ms));

  const lines: string[] = [];
  for (const date of Object.keys(byDate).sort().reverse()) {
    const day = byDate[date] || {};
    const parts: string[] = [];

    const battery = (day.battery || []).filter((s) => Number.isFinite(s.level) && s.level >= 0).sort(byTime);
    if (battery.length) {
      const first = battery[0];
      const last = battery[battery.length - 1];
      parts.push(`BB ${first.level} → ${last.level}`);

      const peak = battery.reduce((a, b) => (b.level > a.level ? b : a));
      const min = battery.reduce((a, b) => (b.level < a.level ? b : a));
      parts.push(`pico ${peak.level} (${t(peak.timestamp_ms)})`);
      parts.push(`mín ${min.level} (${t(min.timestamp_ms)})`);

      const drop = biggestDrop(battery);
      if (drop) {
        parts.push(`mayor caída −${drop.drop} (${t(drop.from.timestamp_ms)}→${t(drop.to.timestamp_ms)})`);
      }
    }

    // Garmin manda −1/−2 cuando la medición no es válida (movimiento, sin uso).
    const stress = (day.stress || []).filter((s) => Number.isFinite(s.level) && s.level >= 0).sort(byTime);
    if (stress.length) {
      const mean = stress.reduce((sum, s) => sum + s.level, 0) / stress.length;
      const peak = stress.reduce((a, b) => (b.level > a.level ? b : a));
      parts.push(`estrés medio ${Math.round(mean)}`);
      parts.push(`pico ${peak.level} (${t(peak.timestamp_ms)})`);
      const highMin = approxMinutesAtOrAbove(stress, HIGH_STRESS_THRESHOLD);
      if (highMin > 0) parts.push(`~${highMin} min en estrés alto (≥${HIGH_STRESS_THRESHOLD})`);
      else parts.push(`0 min en estrés alto (≥${HIGH_STRESS_THRESHOLD})`);
    }

    if (parts.length) lines.push(`  ${date} | ${parts.join(" | ")}`);
  }

  if (!lines.length) return "";
  return [
    "BODY BATTERY Y ESTRÉS INTRADÍA (últimos días, resumen de las muestras del reloj):",
    ...lines,
  ].join("\n");
}
