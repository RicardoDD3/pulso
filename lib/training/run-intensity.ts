// run-intensity.ts — Clasificación de carreras Garmin por intensidad de FC
// (HIIT / tempo / Z2 / sin FC) para los prompts de los chats y la generación
// de planes. Señales en cascada: firma de intervalos (spread max−avg), zonas
// del plan activo, % del máximo personal de 90 días, cortes absolutos.

import type { HrZone } from "./types";

export type RunIntensity = "hiit" | "tempo" | "z2" | "sin_fc";

export interface ClassifiableRun {
  avg_hr?: number | null;
  max_hr?: number | null;
}

export interface RunIntensityContext {
  /** Máx max_hr observado en 90 días (proxy de FC máx personal). */
  hrMaxPersonal?: number | null;
  /** Zonas de FC del plan activo (plan_json.hr_zones), si existe. */
  zones?: HrZone[] | null;
}

/** Spread max−avg mínimo para que una carrera huela a intervalos. */
export const HIIT_SPREAD_BPM = 28;
/** El pico además debe llegar al 90% de la referencia (evita fondos con colinas). */
export const HIIT_MAX_PCT = 0.9;
/** % del máx personal: techo de Z2 y de tempo. */
export const Z2_PCT_MAX = 0.78;
export const TEMPO_PCT_MAX = 0.87;
/** Cortes absolutos de último recurso (sin zonas ni máx personal). */
export const Z2_ABS_MAX_BPM = 145;
export const TEMPO_ABS_MAX_BPM = 165;
/** Un máx personal menor a esto no es fisiológicamente creíble como referencia. */
export const MIN_VALID_HR_MAX = 120;

export const INTENSITY_LABEL: Record<RunIntensity, string> = {
  hiit: "HIIT",
  tempo: "tempo",
  z2: "Z2",
  sin_fc: "s/FC",
};

/** Máx max_hr observado en las carreras; null si no hay dato creíble. */
export function personalHrMax(runs: Array<{ max_hr?: number | null }>): number | null {
  let best = 0;
  for (const r of runs) {
    const m = Number(r.max_hr || 0);
    if (m > best) best = m;
  }
  return best >= MIN_VALID_HR_MAX ? best : null;
}

/** Número de zona (1-5) donde cae avg, o null si no hay zonas usables. */
function zoneNumberOf(avg: number, zones: HrZone[]): number | null {
  const usable = zones
    .filter((z) => Array.isArray(z.bpm_range) && z.bpm_range.length === 2)
    .map((z) => ({ n: Number(String(z.zone).replace(/\D/g, "")), lo: z.bpm_range[0], hi: z.bpm_range[1] }))
    .filter((z) => z.n >= 1 && Number.isFinite(z.lo) && Number.isFinite(z.hi));
  if (!usable.length) return null;

  const containing = usable.find((z) => avg >= z.lo && avg <= z.hi);
  if (containing) return containing.n;

  // Huecos entre zonas: primera zona (por techo) que alcanza el promedio;
  // por encima de todas: la zona más alta.
  const byCeiling = [...usable].sort((a, b) => a.hi - b.hi);
  const above = byCeiling.find((z) => avg <= z.hi);
  return (above ?? byCeiling[byCeiling.length - 1]).n;
}

/**
 * Califica el pico REAL de una carrera (activities.max_hr): la zona del plan
 * que alcanza, o el % del máx personal de 90 días sin plan. Null sin referencia.
 */
export function peakZoneLabel(
  maxHr: number | null | undefined,
  ctx: RunIntensityContext = {}
): string | null {
  const hr = Number(maxHr || 0);
  if (hr <= 0) return null;
  if (ctx.zones?.length) {
    const n = zoneNumberOf(hr, ctx.zones);
    return n != null ? `Z${n}` : null;
  }
  if (ctx.hrMaxPersonal && ctx.hrMaxPersonal >= MIN_VALID_HR_MAX) {
    return `${Math.round((hr / ctx.hrMaxPersonal) * 100)}% de su máx 90d`;
  }
  return null;
}

/**
 * Umbrales en bpm para la curva intradía: techo de la zona fácil (Z2) y piso
 * de la zona de calidad (Z4), desde el plan o como % del máx personal.
 */
export function intensityCuts(
  ctx: RunIntensityContext = {}
): { easyMaxBpm: number | null; qualityMinBpm: number | null } {
  if (ctx.zones?.length) {
    const zone = (n: number) =>
      ctx.zones!.find(
        (z) =>
          Number(String(z.zone).replace(/\D/g, "")) === n &&
          Array.isArray(z.bpm_range) &&
          z.bpm_range.length === 2
      );
    const z2 = zone(2);
    const z4 = zone(4);
    return { easyMaxBpm: z2 ? z2.bpm_range[1] : null, qualityMinBpm: z4 ? z4.bpm_range[0] : null };
  }
  if (ctx.hrMaxPersonal && ctx.hrMaxPersonal >= MIN_VALID_HR_MAX) {
    return {
      easyMaxBpm: Math.round(Z2_PCT_MAX * ctx.hrMaxPersonal),
      qualityMinBpm: Math.round(TEMPO_PCT_MAX * ctx.hrMaxPersonal),
    };
  }
  return { easyMaxBpm: null, qualityMinBpm: null };
}

/** Clasifica una carrera por su FC. Sin avg_hr no hay nada que clasificar. */
export function classifyRun(run: ClassifiableRun, ctx: RunIntensityContext = {}): RunIntensity {
  const avg = Number(run.avg_hr || 0);
  if (avg <= 0) return "sin_fc";
  const max = Number(run.max_hr || 0);

  // Firma de intervalos: el promedio baja por las recuperaciones pero los
  // picos se disparan. El pico debe acercarse al máx real para no confundir
  // un fondo Z2 con colinas o sprint final.
  if (max > 0 && max - avg >= HIIT_SPREAD_BPM) {
    const ref = ctx.hrMaxPersonal && ctx.hrMaxPersonal >= MIN_VALID_HR_MAX ? ctx.hrMaxPersonal : null;
    if (ref == null || max >= HIIT_MAX_PCT * ref) return "hiit";
  }

  if (ctx.zones?.length) {
    const zone = zoneNumberOf(avg, ctx.zones);
    if (zone != null) {
      if (zone <= 2) return "z2";
      if (zone === 3) return "tempo";
      return "hiit";
    }
  }

  if (ctx.hrMaxPersonal && ctx.hrMaxPersonal >= MIN_VALID_HR_MAX) {
    const pct = avg / ctx.hrMaxPersonal;
    if (pct <= Z2_PCT_MAX) return "z2";
    if (pct <= TEMPO_PCT_MAX) return "tempo";
    return "hiit";
  }

  if (avg <= Z2_ABS_MAX_BPM) return "z2";
  if (avg <= TEMPO_ABS_MAX_BPM) return "tempo";
  return "hiit";
}
