/**
 * Adaptador de filas canónicas `workouts` → `TrainingActivity`.
 *
 * Es el ÚNICO puente entre el esquema canónico de este repo y la lógica de
 * training portada de el-consejo, que consume el shape de la DB vieja de Garmin
 * (`activity_id`, `distance_meters`, `duration_seconds`, `avg_hr`, `max_hr`…).
 * La lógica portada no se toca; todo cambio de esquema se absorbe aquí.
 */

import type { WorkoutRow } from "@/lib/db/schema";
import type { TrainingActivity } from "./plan-insights";

/**
 * Ref numérica estable derivada del uuid de `workouts.id` (FNV-1a 32 bits).
 *
 * La lógica portada tipa `activity_id` como number (los ids de Garmin eran
 * bigint crecientes); el id canónico es uuid. Ningún módulo portado LEE el
 * valor más allá de usarlo como identidad estable (los consumidores de
 * TrainingActivity ordenan por fecha, no por id), así que un hash determinístico
 * del uuid cumple el contrato de "ref estable" del spec (doc 09).
 */
export function stableActivityRef(workoutId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < workoutId.length; i++) {
    h ^= workoutId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 fuerza entero positivo de 32 bits.
  return h >>> 0;
}

/** Mapea una fila canónica de `workouts` al shape que consume la lógica portada. */
export function toTrainingActivity(w: WorkoutRow): TrainingActivity {
  return {
    activity_id: stableActivityRef(w.id),
    // Fecha calendario (YYYY-MM-DD, UTC) del inicio del workout.
    date: w.startAt.toISOString().split("T")[0],
    activity_type: w.sport,
    distance_meters: w.distanceM ?? null,
    duration_seconds: w.durationS ?? null,
    avg_hr: w.hrAvg ?? null,
    max_hr: w.hrMax ?? null,
    vo2max_value: w.vo2max ?? null,
    avg_speed: w.speedAvgMps ?? null,
  };
}
