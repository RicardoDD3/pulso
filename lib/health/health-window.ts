/**
 * Ventana de días de datos de salud que viaja al system prompt de los 3 chats
 * de Biohacking (Coach de Biomarcadores, coach de Tracking y chat "Planes").
 *
 * POR QUÉ ES UNA CONSTANTE Y NO UN 90 (O UN 30) SUELTO: la ventana no solo
 * decide el `gte(date)` de ~10 queries en `fetch-health-data.ts` — también
 * aparece en las ETIQUETAS del prompt ("últimos N días", "promedios 7/30/N",
 * "ventanas 7/30/N"). Si el filtro y la etiqueta se desincronizan, el chat
 * anuncia una ventana que no tiene y responde con datos que no existen, sin
 * ningún error que lo avise. Todo se deriva de aquí.
 *
 * El tamaño del prompt escala casi 1:1 con esta ventana (el system prompt es
 * ~90% del input de cada consulta), así que el valor correcto depende de lo que
 * cueste el input del LLM por defecto:
 *
 *   90 días → ~80 KB / ~50k tokens para un usuario denso
 *   30 días → ~54 KB / ~33k tokens
 *
 * Se bajó a 30 cuando el default era Gemini ($2.00/M de input). Volvió a 90 al
 * pasar el default a DeepSeek V4 Pro ($0.435/M, y $0.0036/M en cache hit): con
 * ese precio los 3 meses de historia cuestan ~$1/mes más y el chat recupera la
 * tendencia completa de cada métrica. Si el default vuelve a un modelo caro,
 * este número es la primera palanca a revisar.
 *
 * PULSO: el knob vive en el env (`HEALTH_WINDOW_DAYS`, default 90 en
 * lib/env.ts) — sigue siendo UNA sola perilla: filtros y etiquetas del prompt
 * derivan de esta constante y nada más.
 */
import { getEnv } from "@/lib/env";

function windowDaysFromEnv(): number {
  // getEnv() valida TODO el entorno (DATABASE_URL incluido); los tests puros
  // no lo tienen. Sin entorno completo se lee la variable directa y, si
  // tampoco está, aplica el default del schema (90).
  try {
    return getEnv().HEALTH_WINDOW_DAYS;
  } catch {
    const n = Number(process.env.HEALTH_WINDOW_DAYS);
    return Number.isInteger(n) && n > 0 ? n : 90;
  }
}

export const HEALTH_WINDOW_DAYS = windowDaysFromEnv();

/**
 * Ventanas de los promedios/estadísticas por métrica. Se recortan a la ventana
 * de datos: pedir un promedio de 90 días cuando solo llegan 30 devolvería el
 * mismo número que la de 30 y haría creer al chat que tiene 3 meses de historia.
 */
export const TREND_WINDOWS: number[] = [...new Set([7, 30, HEALTH_WINDOW_DAYS])]
  .filter((days) => days <= HEALTH_WINDOW_DAYS)
  .sort((a, b) => a - b);

/** "7/30" — para las etiquetas del prompt. */
export const TREND_WINDOWS_LABEL = TREND_WINDOWS.join("/");
