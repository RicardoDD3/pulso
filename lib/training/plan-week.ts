/**
 * Ancla temporal del plan: qué semana es "la semana en curso".
 *
 * Sin esto, los prompts que editan el plan (`buildModifyPrompt`) le mandaban al
 * LLM las 32 semanas sin decirle qué día es hoy, así que una instrucción sin
 * semana explícita ("cambia el miércoles a 10 km") aterrizaba en la semana 1
 * aunque el usuario fuera en la 23.
 *
 * Todo es puro y trabaja con fechas `YYYY-MM-DD` en aritmética UTC (mismo
 * patrón que el resto de `lib/training`); el llamador decide qué es "hoy"
 * (normalmente la fecha en `America/Mexico_City`).
 */

import { DAY_LABELS } from "./plan-static-data";
import type { GeneratedPlan } from "./plan-generator-types";

export interface CurrentWeek {
  weekNumber: number;
  weekStartDate: string;
  /** Índice de hoy en la semana (0=Lun … 6=Dom); null si hoy cae fuera del plan. */
  dayIndex: number | null;
  /** Etiqueta corta del día ("Mié"); null si hoy cae fuera del plan. */
  dayLabel: string | null;
}

/** Días completos entre dos fechas YYYY-MM-DD (b - a). */
function daysBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * La semana del plan que contiene `today`.
 *
 * Fuera del rango del plan devuelve la semana más cercana (la primera si el
 * plan aún no arranca, la última si ya terminó) con `dayIndex: null`, para que
 * el prompt siempre tenga un ancla y nunca caiga por default a la semana 1.
 * `null` solo si el plan no tiene semanas.
 */
export function resolveCurrentWeek(
  plan: GeneratedPlan,
  today: string
): CurrentWeek | null {
  const weeks = (plan?.weeks ?? []).filter((w) => w && w.weekStartDate);
  if (weeks.length === 0) return null;

  // No asumas orden: un plan editado puede traer las semanas desordenadas.
  const sorted = [...weeks].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));

  for (const week of sorted) {
    const offset = daysBetween(week.weekStartDate, today);
    if (offset >= 0 && offset <= 6) {
      return {
        weekNumber: week.weekNumber,
        weekStartDate: week.weekStartDate,
        dayIndex: offset,
        dayLabel: week.days?.[offset]?.dayLabel || DAY_LABELS[offset],
      };
    }
  }

  const fallback = today < sorted[0].weekStartDate ? sorted[0] : sorted[sorted.length - 1];
  return {
    weekNumber: fallback.weekNumber,
    weekStartDate: fallback.weekStartDate,
    dayIndex: null,
    dayLabel: null,
  };
}

/** Etiqueta corta del día de la semana de una fecha ("Mié"). */
export function weekdayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return DAY_LABELS[(d.getUTCDay() + 6) % 7];
}

/**
 * Línea de ancla para inyectar en los prompts:
 * `HOY: 2026-08-12 (Mié) — SEMANA EN CURSO: 2 (inicia 2026-08-10)`
 */
export function formatWeekAnchor(plan: GeneratedPlan, today: string): string {
  const head = `HOY: ${today} (${weekdayLabel(today)})`;
  const current = resolveCurrentWeek(plan, today);
  if (!current) return `${head}.`;

  if (current.dayIndex === null) {
    const note =
      today < current.weekStartDate
        ? `el plan aún no ha empezado (arranca el ${current.weekStartDate})`
        : `el plan ya terminó (su última semana inició el ${current.weekStartDate})`;
    return `${head} — SEMANA EN CURSO: ${current.weekNumber} — ${note}.`;
  }

  return `${head} — SEMANA EN CURSO: ${current.weekNumber} (inicia ${current.weekStartDate}).`;
}
