import {
  computeStrengthCompletions,
  type StrengthPlanWorkoutRow,
} from "@/lib/training/strength-completion";

/**
 * Regresión: Jorge registró su fuerza como sets de pesas (exercise_sets:
 * Bench, Squat) el día de fuerza planeado, pero el sync solo marcaba
 * "completed" cuando había un training_workouts (manual). Resultado: la fila
 * de fuerza en training_plan_workouts se quedaba en "planned", y el coach —que
 * lee ese status— reportaba la sesión como PENDIENTE aunque la UI (que mira
 * exercise_sets) ya la contaba como hecha. computeStrengthCompletions cierra
 * ese hueco: los sets de pesas también completan la sesión de fuerza.
 */
describe("computeStrengthCompletions", () => {
  const row = (
    over: Partial<StrengthPlanWorkoutRow> & { id: number; date: string }
  ): StrengthPlanWorkoutRow => ({
    status: "planned",
    matched_workout_id: null,
    ...over,
  });

  it("completa un día de fuerza con sets de pesas pero SIN workout manual (el bug)", () => {
    const workouts = [row({ id: 1, date: "2026-07-27" })];
    const updates = computeStrengthCompletions(
      workouts,
      new Map(), // sin workouts manuales
      new Set(["2026-07-27"]) // sí hay sets de pesas ese día
    );

    expect(updates).toEqual([{ id: 1, status: "completed" }]);
  });

  it("completa con matched_workout_id cuando hay workout manual", () => {
    const workouts = [row({ id: 2, date: "2026-07-27" })];
    const updates = computeStrengthCompletions(
      workouts,
      new Map([["2026-07-27", { id: 55 }]]),
      new Set()
    );

    expect(updates).toEqual([
      { id: 2, status: "completed", matched_workout_id: 55 },
    ]);
  });

  it("prefiere el workout manual (matched_workout_id) cuando hay ambos", () => {
    const workouts = [row({ id: 3, date: "2026-07-27" })];
    const updates = computeStrengthCompletions(
      workouts,
      new Map([["2026-07-27", { id: 55 }]]),
      new Set(["2026-07-27"])
    );

    expect(updates).toEqual([
      { id: 3, status: "completed", matched_workout_id: 55 },
    ]);
  });

  it("es idempotente: ya completado por pesas no se vuelve a actualizar", () => {
    const workouts = [row({ id: 4, date: "2026-07-27", status: "completed" })];
    const updates = computeStrengthCompletions(
      workouts,
      new Map(),
      new Set(["2026-07-27"])
    );

    expect(updates).toEqual([]);
  });

  it("no re-actualiza un día ya matcheado a un workout manual", () => {
    const workouts = [
      row({ id: 5, date: "2026-07-27", status: "completed", matched_workout_id: 55 }),
    ];
    const updates = computeStrengthCompletions(
      workouts,
      new Map([["2026-07-27", { id: 55 }]]),
      new Set()
    );

    expect(updates).toEqual([]);
  });

  it("no toca días de fuerza sin ningún registro", () => {
    const workouts = [row({ id: 6, date: "2026-07-30" })];
    const updates = computeStrengthCompletions(workouts, new Map(), new Set());

    expect(updates).toEqual([]);
  });

  it("maneja varios días a la vez (pesas, manual y sin registro)", () => {
    const workouts = [
      row({ id: 1, date: "2026-07-27" }), // pesas
      row({ id: 2, date: "2026-07-30" }), // manual
      row({ id: 3, date: "2026-08-01" }), // nada
    ];
    const updates = computeStrengthCompletions(
      workouts,
      new Map([["2026-07-30", { id: 88 }]]),
      new Set(["2026-07-27"])
    );

    expect(updates).toEqual([
      { id: 1, status: "completed" },
      { id: 2, status: "completed", matched_workout_id: 88 },
    ]);
  });
});
