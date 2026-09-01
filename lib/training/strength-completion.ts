/**
 * Completado de sesiones de fuerza planeadas.
 *
 * Un día de fuerza (`training_plan_workouts.workout_type === "strength"`) se
 * cuenta como HECHO si ese día hubo:
 *   - un entrenamiento manual de fuerza (`training_workouts` type strength), o
 *   - al menos un set de pesas (`exercise_sets`).
 *
 * Esta es la MISMA regla que usa la UI en `computeStrengthStatus`
 * (week-tracks.ts): `done = manual.length > 0 || weighted > 0`. Antes el sync
 * solo miraba los workouts manuales, así que registrar fuerza como pesas dejaba
 * la fila en "planned" y el coach —que lee ese status— la reportaba como
 * PENDIENTE aunque la UI ya la contaba. Esta función alinea ambas fuentes.
 */

/** Fila mínima de training_plan_workouts (solo fuerza) que necesita el cálculo. */
export interface StrengthPlanWorkoutRow {
  id: number;
  date: string;
  status: string | null;
  matched_workout_id: number | null;
}

/** Actualización a aplicar sobre una fila de fuerza. */
export interface StrengthCompletionUpdate {
  id: number;
  status: "completed";
  /** Solo cuando la completa un workout manual (los sets de pesas no tienen id de workout). */
  matched_workout_id?: number;
}

/**
 * Decide qué filas de fuerza deben marcarse "completed".
 *
 * @param strengthWorkouts filas de fuerza del plan (workout_type "strength")
 * @param manualByDate     fecha → workout manual de fuerza de ese día
 * @param weightedSetDates fechas con al menos un set de pesas registrado
 */
export function computeStrengthCompletions(
  strengthWorkouts: StrengthPlanWorkoutRow[],
  manualByDate: Map<string, { id: number }>,
  weightedSetDates: Set<string>
): StrengthCompletionUpdate[] {
  const updates: StrengthCompletionUpdate[] = [];

  for (const pw of strengthWorkouts) {
    const manual = manualByDate.get(pw.date);

    // El workout manual gana: enlaza matched_workout_id (comportamiento previo).
    if (manual && !pw.matched_workout_id) {
      updates.push({ id: pw.id, status: "completed", matched_workout_id: manual.id });
      continue;
    }

    // Sin manual pero con sets de pesas: completa sin matched_workout_id.
    // Idempotente: si ya está "completed" no genera update.
    if (!manual && weightedSetDates.has(pw.date) && pw.status !== "completed") {
      updates.push({ id: pw.id, status: "completed" });
    }
  }

  return updates;
}
