/**
 * Puente cliente entre las rutas de Pulso (filas camelCase serializadas por
 * los repos) y los shapes snake_case que consume la lógica portada de
 * lib/training/plan-insights.ts. Espejo cliente de lib/training/adapter.ts:
 * la lógica portada no se toca; todo cambio de API se absorbe aquí.
 */

import { stableActivityRef } from "@/lib/training/adapter";
import type {
  GarminDailySummary,
  GarminSleep,
  TrainingActivity,
  MatchedWorkoutActivity,
} from "@/lib/training/plan-insights";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";
import type { PlanWeek, PlannedWorkout, TrainingPlanWorkout } from "@/lib/training/types";
import { weekTargetKm, type PlanWorkoutRow } from "@/components/training/types";

/** Contenedor visual compartido (el original usaba la utilidad `glass-panel`). */
export const PANEL_CLASS = "border border-slate-700/50 bg-slate-900/60 backdrop-blur-md";

/* ------------------------------------------------------------------ */
/* Shapes JSON de las rutas de Pulso                                   */
/* ------------------------------------------------------------------ */

/** Fila mergeada de /api/health/daily y /api/health/trends (`daily[]`). */
export interface HealthDayJson {
  date: string;
  steps?: number | null;
  floors?: number | null;
  intensityMinutes?: number | null;
  caloriesTotal?: number | null;
  restingHr?: number | null;
  stressAvg?: number | null;
  bodyBatteryHigh?: number | null;
  bodyBatteryLow?: number | null;
  spo2Avg?: number | null;
  respirationAvg?: number | null;
  hrvMs?: number | null;
  hydrationMl?: number | null;
}

/** Sesión de sueño: /api/health/daily (`sleep[]`) o /api/health/trends (`sleep[]`). */
export interface SleepJson {
  date?: string;
  endAt?: string;
  totalMin?: number | null;
  score?: number | null;
  isNap?: boolean | null;
}

/** Fila canónica de `workouts` como la serializa /api/health/workouts. */
export interface WorkoutJson {
  id: string;
  provider?: string;
  sport: string;
  name?: string | null;
  startAt: string;
  durationS: number | null;
  distanceM: number | null;
  hrAvg?: number | null;
  hrMax?: number | null;
  vo2max?: number | null;
  speedAvgMps?: number | null;
}

/** Item de /api/training/plans/[id]/matched-activities. */
export interface MatchJson {
  workout: PlanWorkoutRow;
  activity: TrainingActivity | null;
  activities?: TrainingActivity[];
}

/* ------------------------------------------------------------------ */
/* Adaptadores                                                         */
/* ------------------------------------------------------------------ */

export function toDailySummary(d: HealthDayJson): GarminDailySummary {
  return {
    date: d.date,
    steps: d.steps ?? null,
    resting_hr: d.restingHr ?? null,
    avg_stress: d.stressAvg ?? null,
    body_battery_high: d.bodyBatteryHigh ?? null,
    body_battery_low: d.bodyBatteryLow ?? null,
    spo2: d.spo2Avg ?? null,
    respiration_rate: d.respirationAvg ?? null,
    hrv_weekly_avg: d.hrvMs ?? null,
    calories_total: d.caloriesTotal ?? null,
    hydration_ml: d.hydrationMl ?? null,
    floors_climbed: d.floors ?? null,
    intensity_minutes: d.intensityMinutes ?? null,
  };
}

export function toSleep(s: SleepJson): GarminSleep {
  return {
    date: s.date ?? (s.endAt ? s.endAt.slice(0, 10) : ""),
    sleep_seconds: s.totalMin != null ? s.totalMin * 60 : null,
    sleep_score: s.score ?? null,
  };
}

/** La noche principal de una fecha: la sesión no-siesta más larga. */
export function pickMainSleep(rows: SleepJson[]): SleepJson | null {
  const nights = rows.filter((r) => !r.isNap);
  if (nights.length === 0) return null;
  return nights.reduce((best, r) => ((r.totalMin ?? 0) > (best.totalMin ?? 0) ? r : best));
}

/** Espejo cliente de lib/training/adapter.toTrainingActivity (startAt viene como ISO string). */
export function workoutToActivity(w: WorkoutJson): TrainingActivity {
  return {
    activity_id: stableActivityRef(w.id),
    date: w.startAt.slice(0, 10),
    activity_type: w.sport,
    distance_meters: w.distanceM ?? null,
    duration_seconds: w.durationS ?? null,
    avg_hr: w.hrAvg ?? null,
    max_hr: w.hrMax ?? null,
    vo2max_value: w.vo2max ?? null,
    avg_speed: w.speedAvgMps ?? null,
  };
}

/** Mismo criterio que lib/training/activity-match.isRunning. */
export function isRunningActivity(a: { activity_type: string }): boolean {
  return String(a.activity_type || "").toLowerCase().includes("running");
}

function toNumberOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fila camelCase de training_plan_workouts → shape snake_case de la lógica portada. */
export function rowToInsightsWorkout(row: PlanWorkoutRow): MatchedWorkoutActivity["workout"] {
  return {
    id: stableActivityRef(row.id),
    plan_id: stableActivityRef(row.planId),
    week_number: row.weekNumber,
    date: row.date ?? "",
    workout_type: row.workoutType,
    title: row.title ?? "",
    target_distance_km: toNumberOrNull(row.targetDistanceKm),
    target_pace_range: row.targetPaceRange,
    target_hr_zone: row.targetHrZone,
    status: row.status,
    actual_distance_km: toNumberOrNull(row.actualDistanceKm),
    actual_pace: toNumberOrNull(row.actualPace),
  };
}

export function toMatchedActivity(m: MatchJson): MatchedWorkoutActivity {
  return {
    workout: rowToInsightsWorkout(m.workout),
    activity: m.activity,
    activities: m.activities ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* plan_json + filas → shapes legacy (ComplianceChart / PlanCalendar)  */
/* ------------------------------------------------------------------ */

export function isGeneratedPlan(json: unknown): json is GeneratedPlan {
  const p = json as GeneratedPlan | null;
  return (
    !!p &&
    Array.isArray(p.weeks) &&
    p.weeks.length > 0 &&
    Array.isArray(p.weeks[0]?.days) &&
    typeof p.raceDate === "string"
  );
}

function phaseForWeek(planJson: unknown, weekNumber: number): string {
  const weeks = (planJson as { weeks?: unknown[] } | null)?.weeks;
  if (!Array.isArray(weeks)) return "";
  for (const raw of weeks) {
    const w = raw as { weekNumber?: number; week_number?: number; phase?: string };
    if ((w.weekNumber ?? w.week_number) === weekNumber) return w.phase ?? "";
  }
  return "";
}

export function rowToPlannedWorkout(row: PlanWorkoutRow): PlannedWorkout {
  return {
    day_of_week: row.dayOfWeek,
    date: row.date ?? "",
    workout_type: row.workoutType,
    title: row.title ?? "",
    description: "",
    target_distance_km: toNumberOrNull(row.targetDistanceKm),
    target_duration_min: null,
    target_pace_range: row.targetPaceRange,
    target_hr_zone: row.targetHrZone,
    intervals_detail: null,
    strength_exercises: null,
  };
}

export function rowToTrainingPlanWorkout(row: PlanWorkoutRow): TrainingPlanWorkout {
  const w = rowToInsightsWorkout(row);
  return {
    ...w,
    day_of_week: row.dayOfWeek,
    matched_activity_id: null,
    matched_workout_id: null,
    created_at: "",
  };
}

/** Sintetiza PlanWeek[] (shape legacy) desde las filas + plan_json (fase/meta). */
export function buildPlanWeeks(planJson: unknown, rows: PlanWorkoutRow[]): PlanWeek[] {
  const byWeek = new Map<number, PlanWorkoutRow[]>();
  for (const row of rows) {
    const list = byWeek.get(row.weekNumber) ?? [];
    list.push(row);
    byWeek.set(row.weekNumber, list);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekNumber, weekRows]) => {
      const sorted = [...weekRows].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
      const targetKm =
        weekTargetKm(planJson, weekNumber) ??
        sorted.reduce((s, r) => s + (toNumberOrNull(r.targetDistanceKm) ?? 0), 0);
      return {
        week_number: weekNumber,
        phase: phaseForWeek(planJson, weekNumber),
        target_km: Math.round(targetKm * 10) / 10,
        notes: "",
        workouts: sorted.map(rowToPlannedWorkout),
      };
    });
}
