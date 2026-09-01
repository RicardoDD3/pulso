/**
 * Fechas calendario en la zona horaria DEL USUARIO (profiles.timezone).
 *
 * El original anclaba todo a CDMX (`todayCdmx`); Pulso es multi-usuario y la
 * tz viene del perfil. Todo puro: la fecha "actual" es inyectable para que los
 * tests no dependan del reloj. El prompt del coach es determinístico por
 * (usuario, feature, día-en-su-tz), así que este módulo es la única fuente de
 * "hoy" del contexto de salud.
 */
import { HEALTH_WINDOW_DAYS } from "./health-window";

/** Fecha calendario (YYYY-MM-DD) de un instante en una tz IANA. */
export function dateInTz(at: Date, tz: string): string {
  try {
    return at.toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    // tz corrupta en el perfil: mejor UTC que tirar el chat completo.
    return at.toLocaleDateString("en-CA", { timeZone: "UTC" });
  }
}

/** Hoy (YYYY-MM-DD) en la tz del usuario. */
export function todayInTz(tz: string, at: Date = new Date()): string {
  return dateInTz(at, tz);
}

/** Fecha `days` días antes de dateStr (YYYY-MM-DD, aritmética UTC). */
export function daysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * Límite inferior de TODAS las queries de la ventana de salud. Deriva de la
 * MISMA constante que las etiquetas del prompt (regla dura del doc 08): si el
 * filtro y la etiqueta se desincronizan, el chat anuncia una ventana que no
 * tiene.
 */
export function healthWindowFrom(today: string): string {
  return daysBefore(today, HEALTH_WINDOW_DAYS);
}
