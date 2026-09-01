/**
 * Bloque "FUERZA REGISTRADA" para los prompts de los chats de Training.
 *
 * `fetchHealthData` leía `training_workouts` (entrenamientos manuales) pero
 * nunca `exercise_sets` (pesas) ni `exercise_logs` (reps de peso corporal), así
 * que ninguno de los tres chats (Tracking, Planes, Biohacking) veía la fuerza
 * que el usuario registra desde la app: contestaban "no tengo ese dato" o lo
 * daban por no hecho.
 *
 * Todo es puro: entra lo que ya trae Supabase, sale el texto del prompt.
 */

import { weekdayLabel } from "./plan-week";
import { HEALTH_WINDOW_DAYS } from "@/lib/health/health-window";

/** Fila de `exercise_sets` (una serie con peso). */
export interface StrengthSetRow {
  date: string;
  exercise: string;
  weight_kg: number | null;
  reps: number | null;
  set_number?: number | null;
}

/** Fila de `exercise_logs` (total diario de reps de peso corporal). */
export interface BodyweightLogRow {
  date: string;
  exercise: string;
  reps: number | null;
}

/** Fila de `exercise_definitions` (catálogo del usuario). */
export interface StrengthDef {
  exercise_key: string;
  label?: string | null;
  type?: string | null;
  weekly_goal?: number | null;
}

/** Semanas de historial resumido (además de la semana en curso, que va día a día). */
const WEEKS_SUMMARIZED = 8;

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Lunes de la semana de `dateStr`. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return shiftDate(dateStr, -((d.getUTCDay() + 6) % 7));
}

/** 1700 → "1,700" (sin depender del locale del runtime). */
function withThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Agrupa por una llave derivada, preservando el orden de inserción. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Texto del bloque de fuerza: semana en curso día a día, resumen por semana,
 * récords de peso y avance contra las metas semanales de peso corporal.
 */
export function formatStrengthLog(
  sets: StrengthSetRow[],
  logs: BodyweightLogRow[],
  defs: StrengthDef[],
  today: string
): string {
  if (sets.length === 0 && logs.length === 0) {
    return `Sin fuerza registrada (ni series de pesas ni reps de peso corporal) en los últimos ${HEALTH_WINDOW_DAYS} días.`;
  }

  const labelOf = new Map(defs.map((d) => [d.exercise_key, d.label || d.exercise_key]));
  const label = (key: string) => labelOf.get(key) || key;

  const lines: string[] = [];
  const weekStart = mondayOf(today);

  // --- Semana en curso, día a día (hasta hoy; los días futuros no se inventan).
  const currentSets = sets.filter((s) => s.date >= weekStart && s.date <= today);
  const currentLogs = logs.filter((l) => l.date >= weekStart && l.date <= today);

  lines.push(`Semana en curso (desde ${weekStart}):`);
  for (let d = shiftDate(weekStart, 0); d <= today; d = shiftDate(d, 1)) {
    const daySets = currentSets.filter((s) => s.date === d);
    const dayLogs = currentLogs.filter((l) => l.date === d);
    const parts: string[] = [];

    for (const [exercise, rows] of groupBy(daySets, (s) => s.exercise)) {
      const detail = rows
        .slice()
        .sort((a, b) => num(a.set_number) - num(b.set_number))
        .map((r) => `${num(r.weight_kg)}×${num(r.reps)}`)
        .join(", ");
      parts.push(`${label(exercise)} ${rows.length} series — ${detail}`);
    }
    for (const l of dayLogs) {
      parts.push(`${label(l.exercise)} ${num(l.reps)} reps`);
    }

    lines.push(`  ${d} (${weekdayLabel(d)}): ${parts.length ? parts.join(" | ") : "sin registro"}`);
  }

  // --- Resumen por semana (incluye la actual, para tener la comparación).
  const byWeek = new Map<string, { dates: Set<string>; series: number; tonnage: number; reps: number }>();
  const bucket = (date: string) => {
    const key = mondayOf(date);
    let b = byWeek.get(key);
    if (!b) {
      b = { dates: new Set(), series: 0, tonnage: 0, reps: 0 };
      byWeek.set(key, b);
    }
    return b;
  };
  for (const s of sets) {
    const b = bucket(s.date);
    b.dates.add(s.date);
    b.series += 1;
    b.tonnage += num(s.weight_kg) * num(s.reps);
  }
  for (const l of logs) {
    bucket(l.date).reps += num(l.reps);
  }

  const weekKeys = [...byWeek.keys()].sort().reverse().slice(0, WEEKS_SUMMARIZED);
  if (weekKeys.length) {
    lines.push("Por semana:");
    for (const key of weekKeys) {
      const b = byWeek.get(key)!;
      const segments: string[] = [];
      if (b.series > 0) {
        segments.push(
          `${b.dates.size} sesiones de pesas, ${b.series} series, ${withThousands(b.tonnage)} kg de tonelaje`
        );
      }
      if (b.reps > 0) segments.push(`${withThousands(b.reps)} reps de peso corporal`);
      lines.push(`  sem del ${key}: ${segments.join(" | ")}`);
    }
  }

  // --- Récords de peso por ejercicio (con fecha).
  const prs = new Map<string, { weight: number; date: string }>();
  for (const s of sets) {
    const w = num(s.weight_kg);
    if (w <= 0) continue;
    const prev = prs.get(s.exercise);
    if (!prev || w > prev.weight) prs.set(s.exercise, { weight: w, date: s.date });
  }
  if (prs.size) {
    const parts = [...prs.entries()].map(
      ([key, pr]) => `${label(key)} ${pr.weight} kg (${pr.date})`
    );
    lines.push(`Récords (peso máx por ejercicio): ${parts.join(" | ")}`);
  }

  // --- Peso corporal vs meta semanal (solo la semana en curso).
  const goals = defs.filter((d) => num(d.weekly_goal) > 0);
  if (goals.length) {
    const parts = goals.map((d) => {
      const done = currentLogs
        .filter((l) => l.exercise === d.exercise_key)
        .reduce((s, l) => s + num(l.reps), 0);
      return `${label(d.exercise_key)} ${withThousands(done)}/${withThousands(num(d.weekly_goal))}`;
    });
    lines.push(`Peso corporal vs meta semanal (semana en curso): ${parts.join(" | ")}`);
  }

  return lines.join("\n");
}
