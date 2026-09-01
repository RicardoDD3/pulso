import {
  normalizeStrength,
  computeRunTotals,
  computeStrengthStatus,
  computeExerciseTotals,
  computeStepsTotals,
  formatStepsCompact,
  normalizeStepsGoal,
  recalcWeekAggregates,
  WEEKLY_STEPS_GOAL_MIN,
  WEEKLY_STEPS_GOAL_MAX,
  type WeekManualWorkout,
  type WeekExerciseLog,
  type WeekExerciseSet,
  type WeekStepsEntry,
} from "@/lib/training/week-tracks";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
  ExtraSession,
} from "@/lib/training/plan-generator-types";
import type { RebalanceMatch } from "@/lib/training/rebalance";

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function makeDay(
  date: string,
  dayOfWeek: number,
  sessionType: SessionType,
  distanceKm: number,
  strengthDay?: boolean
): GeneratedDay {
  return {
    date,
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek],
    sessionType,
    distanceKm,
    zone: sessionType === "rest" ? "" : "Z2",
    notes: "",
    isKeySession: false,
    ...(strengthDay !== undefined ? { strengthDay } : {}),
  } as GeneratedDay;
}

function makeWeek(
  sessions: [SessionType, number, boolean?][],
  startDate = "2026-07-13"
): GeneratedWeek {
  const days = sessions.map(([type, km, strengthDay], i) => {
    const d = new Date(startDate + "T12:00:00");
    d.setDate(d.getDate() + i);
    return makeDay(d.toISOString().slice(0, 10), i, type, km, strengthDay);
  });
  return {
    weekNumber: 1,
    phase: "build",
    mesoWeek: 1,
    weekStartDate: startDate,
    totalKm: days.reduce((s, d) => s + d.distanceKm, 0),
    z2Km: 0,
    longRunPlusB2bKm: 0,
    days,
    strengthSessions: 0,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
  };
}

function makePlan(weeks: GeneratedWeek[]): GeneratedPlan {
  return {
    raceDistanceKm: 100,
    raceDate: "2026-10-09",
    planWeeks: weeks.length,
    peakWeeklyKm: 100,
    currentWeeklyKm: 50,
    startDate: weeks[0].weekStartDate,
    weeks,
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: { exercises: [], basePhaseFrequency: "", buildPeakFrequency: "", taperFrequency: "" },
  };
}

// ---------------------------------------------------------------------------
// normalizeStrength
// ---------------------------------------------------------------------------

describe("normalizeStrength", () => {
  it("converts strength days to rest + strengthDay flag", () => {
    const plan = makePlan([makeWeek([["z2", 18], ["strength", 0], ["hiit", 9]])]);
    const changed = normalizeStrength(plan);

    expect(changed).toBe(true);
    const day = plan.weeks[0].days[1];
    expect(day.sessionType).toBe("rest");
    expect(day.strengthDay).toBe(true);
    expect(day.distanceKm).toBe(0);
  });

  it("recalculates strengthSessions from the flags", () => {
    const plan = makePlan([
      makeWeek([["strength", 0], ["z2", 10, true], ["rest", 0]]),
    ]);
    normalizeStrength(plan);
    expect(plan.weeks[0].strengthSessions).toBe(2);
  });

  it("is idempotent and reports no changes on a normalized plan", () => {
    const plan = makePlan([makeWeek([["z2", 18], ["rest", 0, true]])]);
    plan.weeks[0].strengthSessions = 1;
    expect(normalizeStrength(plan)).toBe(false);
    expect(plan.weeks[0].days[1].sessionType).toBe("rest");
    expect(plan.weeks[0].days[1].strengthDay).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeRestDays
// ---------------------------------------------------------------------------

import { removeRestDays } from "@/lib/training/week-tracks";

describe("removeRestDays", () => {
  it("converts rest days to z2 redistributing km without changing the week total", () => {
    const plan = makePlan([
      makeWeek([["z2", 20], ["z2", 20], ["rest", 0], ["hiit", 10], ["long_run", 30]]),
    ]);
    const changed = removeRestDays(plan);

    expect(changed).toBe(true);
    const week = plan.weeks[0];
    const exRest = week.days[2];
    expect(exRest.sessionType).toBe("z2");
    expect(exRest.zone).toBe("Z2");
    // share = 80 / 5 días = 16; donadores z2 (20+20) ceden 8 cada uno
    expect(exRest.distanceKm).toBe(16);
    expect(week.days[0].distanceKm).toBe(12);
    expect(week.days[1].distanceKm).toBe(12);
    // HIIT y long run intactos
    expect(week.days[3].distanceKm).toBe(10);
    expect(week.days[4].distanceKm).toBe(30);
    expect(week.totalKm).toBe(80);
  });

  it("caps donors at 50% of their km when the pool is short", () => {
    const plan = makePlan([
      makeWeek([["z2", 10], ["rest", 0], ["rest", 0], ["long_run", 40], ["hiit", 10]]),
    ]);
    removeRestDays(plan);

    const week = plan.weeks[0];
    // need = 2 × (60/5) = 24, pero el único donador solo puede ceder 5
    expect(week.days[0].distanceKm).toBe(5);
    expect(week.days[1].distanceKm).toBe(2.5);
    expect(week.days[2].distanceKm).toBe(2.5);
    expect(week.days[3].distanceKm).toBe(40);
    expect(week.totalKm).toBe(60);
  });

  it("leaves ex-rest days at 0 km when there are no z2 donors", () => {
    const plan = makePlan([makeWeek([["long_run", 30], ["rest", 0]])]);
    const changed = removeRestDays(plan);

    expect(changed).toBe(true);
    expect(plan.weeks[0].days[1].sessionType).toBe("z2");
    expect(plan.weeks[0].days[1].distanceKm).toBe(0);
    expect(plan.weeks[0].days[0].distanceKm).toBe(30);
    expect(plan.weeks[0].totalKm).toBe(30);
  });

  it("preserves the strengthDay flag on converted days", () => {
    const plan = makePlan([makeWeek([["z2", 20], ["rest", 0, true]])]);
    removeRestDays(plan);
    expect(plan.weeks[0].days[1].strengthDay).toBe(true);
    expect(plan.weeks[0].strengthSessions).toBe(1);
  });

  it("is idempotent and reports no changes when there are no rest days", () => {
    const plan = makePlan([
      makeWeek([["z2", 20], ["z2", 20], ["rest", 0], ["hiit", 10], ["long_run", 30]]),
    ]);
    expect(removeRestDays(plan)).toBe(true);
    const snapshot = JSON.stringify(plan);
    expect(removeRestDays(plan)).toBe(false);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("keeps the week total stable despite rounding", () => {
    const plan = makePlan([
      makeWeek([["z2", 18], ["z2", 18], ["z2", 18], ["rest", 0], ["hiit", 9], ["long_run", 31], ["back_to_back", 16]]),
    ]);
    removeRestDays(plan);

    const week = plan.weeks[0];
    const sum = Math.round(week.days.reduce((s, d) => s + d.distanceKm, 0) * 10) / 10;
    expect(sum).toBe(110);
    expect(week.totalKm).toBe(110);
    // ningún donador pierde más del 50%
    for (const km of [week.days[0].distanceKm, week.days[1].distanceKm, week.days[2].distanceKm]) {
      expect(km).toBeGreaterThanOrEqual(9);
    }
    expect(week.days[3].distanceKm).toBeGreaterThan(0);
  });

  it("recalculates z2Km and longRunPlusB2bKm", () => {
    const plan = makePlan([makeWeek([["z2", 20], ["rest", 0], ["long_run", 30]])]);
    removeRestDays(plan);
    const week = plan.weeks[0];
    expect(week.z2Km).toBe(Math.round((week.days[0].distanceKm + week.days[1].distanceKm) * 10) / 10);
    expect(week.longRunPlusB2bKm).toBe(30);
  });

  // Regression (2026-07-20): "los domingos son días de descanso" no se
  // respetaba — removeRestDays revertía a Z2 incluso los descansos pedidos
  // explícitamente por el usuario vía chat "Planes" (flag restLocked).
  it("respects user-requested rest days (restLocked)", () => {
    const plan = makePlan([
      makeWeek([["z2", 20], ["z2", 20], ["rest", 0], ["hiit", 10], ["long_run", 30]]),
    ]);
    plan.weeks[0].days[2].restLocked = true;

    const changed = removeRestDays(plan);

    expect(changed).toBe(false);
    const day = plan.weeks[0].days[2];
    expect(day.sessionType).toBe("rest");
    expect(day.distanceKm).toBe(0);
    // los donadores no ceden km hacia un descanso bloqueado
    expect(plan.weeks[0].days[0].distanceKm).toBe(20);
    expect(plan.weeks[0].days[1].distanceKm).toBe(20);
  });

  it("converts unlocked rest days but keeps locked ones in the same week", () => {
    const plan = makePlan([
      makeWeek([["z2", 20], ["z2", 20], ["rest", 0], ["rest", 0], ["long_run", 30]]),
    ]);
    plan.weeks[0].days[3].restLocked = true;

    const changed = removeRestDays(plan);

    expect(changed).toBe(true);
    // el rest sin bloquear sí se convierte a z2
    expect(plan.weeks[0].days[2].sessionType).toBe("z2");
    // el bloqueado sigue siendo descanso con 0 km
    expect(plan.weeks[0].days[3].sessionType).toBe("rest");
    expect(plan.weeks[0].days[3].distanceKm).toBe(0);
    expect(plan.weeks[0].totalKm).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// recalcWeekAggregates
// ---------------------------------------------------------------------------

describe("recalcWeekAggregates", () => {
  test("cuenta los extras 'moved' y no los demás orígenes", () => {
    const week = makeWeek([["z2", 10], ["hiit", 0], ["long_run", 20]]);
    week.days[0].extraSessions = [
      { id: "mv", sessionType: "hiit", distanceKm: 8, origin: "moved", movedFrom: "2026-07-14" },
      { id: "co", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-14" },
      { id: "mn", sessionType: "z2", distanceKm: 3, origin: "manual" },
    ];
    recalcWeekAggregates(week);
    // 10 + 0 + 20 + 8 (moved) — carryover y manual no cuentan
    expect(week.totalKm).toBe(38);
    expect(week.z2Km).toBe(10);
    expect(week.longRunPlusB2bKm).toBe(20);
  });

  test("un long_run movido suma a longRunPlusB2bKm aunque caiga en un día Z2", () => {
    const week = makeWeek([["z2", 10]]);
    week.days[0].extraSessions = [
      { id: "mv", sessionType: "long_run", distanceKm: 16, origin: "moved", movedFrom: "2026-07-18" },
    ];
    recalcWeekAggregates(week);
    expect(week.totalKm).toBe(26);
    expect(week.z2Km).toBe(10);
    expect(week.longRunPlusB2bKm).toBe(16);
  });

  test("recalcula strengthSessions desde los flags", () => {
    const week = makeWeek([["z2", 10, true], ["z2", 10]]);
    week.strengthSessions = 99;
    recalcWeekAggregates(week);
    expect(week.strengthSessions).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeRunTotals
// ---------------------------------------------------------------------------

describe("computeRunTotals", () => {
  it("aggregates planned and actual km per session group", () => {
    const week = makeWeek([
      ["z2", 18],
      ["hiit", 9],
      ["z2", 18],
      ["long_run", 31],
      ["back_to_back", 16],
      ["rest", 0],
      ["rest", 0],
    ]);
    const matches: RebalanceMatch[] = [
      { date: week.days[0].date, status: "completed", actual_distance_km: 12 },
      { date: week.days[1].date, status: "completed", actual_distance_km: 9.5 },
    ];
    const totals = computeRunTotals(week, matches);

    expect(totals.z2).toEqual({ plannedKm: 36, actualKm: 12 });
    expect(totals.hiit).toEqual({ plannedKm: 9, actualKm: 9.5 });
    expect(totals.longRun).toEqual({ plannedKm: 47, actualKm: 0 });
    expect(totals.total).toEqual({ plannedKm: 92, actualKm: 21.5 });
  });

  it("las sesiones extra NO inflan la meta planeada (redistribución, meta fija)", () => {
    const week = makeWeek([
      ["z2", 18],
      ["hiit", 9],
      ["rest", 0],
    ]);
    week.days[0].extraSessions = [
      { id: "co-1", sessionType: "hiit", distanceKm: 4, origin: "carryover", carryoverFrom: "x" },
    ];
    // Un día rest también puede traer un extra (cuadrito propio)
    week.days[2].extraSessions = [
      { id: "m1", sessionType: "z2", distanceKm: 6, origin: "manual" },
    ];
    const totals = computeRunTotals(week, []);

    // La meta (planned) es la base fija del plan: los extras (carryover o
    // manual) sólo mueven DÓNDE se corren los km, no suman a la meta total.
    expect(totals.z2.plannedKm).toBe(18);
    expect(totals.hiit.plannedKm).toBe(9);
    expect(totals.total.plannedKm).toBe(27); // == suma de days.distanceKm
  });

  // Regresión (2026-07-23): la meta semanal se inflaba con cada pendiente
  // (carryover) porque el faltante se contaba DOS veces — en el día origen
  // (su distanceKm ya está en la base) y otra vez como sesión extra. Jorge veía
  // 141.6 km cuando su plan base era 124. La redistribución no cambia la meta.
  it("un pendiente no infla la meta: se cubre y sólo cuenta como actual", () => {
    // Base: Mié z2 20 (origen del pendiente) + Jue z2 15 → total base 35.
    const week = makeWeek([
      ["z2", 20], // Mié — se quedó corto
      ["z2", 15], // Jue — recibe el pendiente
      ["rest", 0],
    ]);
    const wed = week.days[0].date;
    const thu = week.days[1].date;
    // Pendiente de 4.7 del Mié movido al Jue como cuadrito extra Z2.
    week.days[1].extraSessions = [
      { id: "co-wed", sessionType: "z2", distanceKm: 4.7, origin: "carryover", carryoverFrom: wed },
    ];
    const matches: RebalanceMatch[] = [
      { date: wed, status: "completed", actual_distance_km: 15.3 },
      { date: thu, status: "completed", actual_distance_km: 19.7 },
    ];
    // Jue: 15 (main) + 4.7 (cubre el pendiente) en dos carreras.
    const runsByDate = {
      [wed]: [{ activity_id: 1, distance_meters: 15300, duration_seconds: null, avg_hr: null, max_hr: null }],
      [thu]: [
        { activity_id: 2, distance_meters: 15000, duration_seconds: null, avg_hr: null, max_hr: null },
        { activity_id: 3, distance_meters: 4700, duration_seconds: null, avg_hr: null, max_hr: null },
      ],
    };
    const totals = computeRunTotals(week, matches, runsByDate);

    // Meta fija = base 35 (el 4.7 del pendiente NO se suma otra vez).
    expect(totals.total.plannedKm).toBe(35);
    expect(totals.z2.plannedKm).toBe(35);
    // El actual sí acumula la cobertura del extra (recuperación real): 15.3+15+4.7
    expect(totals.total.actualKm).toBeCloseTo(35, 1);
  });

  it("el actual de un día rest con extra sí cuenta en el total", () => {
    const week = makeWeek([["rest", 0]]);
    week.days[0].extraSessions = [
      { id: "m1", sessionType: "z2", distanceKm: 6, origin: "manual" },
    ];
    const totals = computeRunTotals(week, [
      { date: week.days[0].date, status: "completed", actual_distance_km: 6.2 },
    ]);
    expect(totals.z2.actualKm).toBe(6.2);
    expect(totals.total.actualKm).toBe(6.2);
  });

  it("con carreras del día: cada sesión suma solo lo suyo (asignación, no cascada)", () => {
    const week = makeWeek([
      ["hiit", 9.4],
      ["z2", 20],
      ["rest", 0],
      ["rest", 0],
      ["rest", 0],
      ["rest", 0],
      ["rest", 0],
    ]);
    week.days[0].extraSessions = [
      { id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover", carryoverFrom: "x" },
    ];
    const matches: RebalanceMatch[] = [
      { date: week.days[0].date, status: "completed", actual_distance_km: 10.8 },
    ];
    const runsByDate = {
      [week.days[0].date]: [
        { activity_id: 1, distance_meters: 10800, duration_seconds: null, avg_hr: null, max_hr: null },
      ],
    };
    const totals = computeRunTotals(week, matches, runsByDate);
    // 10.8 está más cerca del extra z2 (11) que del HIIT (9.4): va COMPLETA
    // al z2 — la cascada vieja habría dado 9.4 al HIIT y 1.4 al z2.
    expect(totals.z2.actualKm).toBeCloseTo(10.8, 1);
    expect(totals.hiit.actualKm).toBe(0);
    expect(totals.total.actualKm).toBeCloseTo(10.8, 1);
  });

  it("sin carreras cae al fallback legacy (total del día al primer cuadrito)", () => {
    const week = makeWeek([["z2", 20]]);
    week.days[0].extraSessions = [
      { id: "m1", sessionType: "hiit", distanceKm: 5, origin: "manual" },
    ];
    const matches: RebalanceMatch[] = [
      { date: week.days[0].date, status: "completed", actual_distance_km: 15 },
    ];
    const totals = computeRunTotals(week, matches);
    expect(totals.z2.actualKm).toBeCloseTo(15, 1);
    expect(totals.hiit.actualKm).toBe(0);
  });

  // Regresión (2026-07-24): un 2º entrenamiento suave en un día HIIT (martes y
  // jueves de Jorge) se contaba como HIIT. Ahora se reconoce como Z2.
  it("una 2ª carrera suave en día HIIT cuenta como Z2 (bonus), no como HIIT", () => {
    const week = makeWeek([["hiit", 9.4], ["z2", 20], ["rest", 0]]);
    const runsByDate = {
      [week.days[0].date]: [
        { activity_id: 1, distance_meters: 7400, duration_seconds: null, avg_hr: 130, max_hr: 168 },
        { activity_id: 2, distance_meters: 5000, duration_seconds: null, avg_hr: 116, max_hr: 137 },
      ],
    };
    const totals = computeRunTotals(week, [], runsByDate);
    expect(totals.hiit.actualKm).toBeCloseTo(7.4, 1); // solo la carrera intensa
    expect(totals.z2.actualKm).toBeCloseTo(5, 1); // la suave → Z2
    expect(totals.hiit.plannedKm).toBe(9.4); // el HIIT queda corto (7.4/9.4)
    expect(totals.total.actualKm).toBeCloseTo(12.4, 1);
  });

  describe("computeRunTotals con extras 'moved'", () => {
    test("un moved suma a plannedKm de su grupo y al total", () => {
      const week = makeWeek([["z2", 10]]);
      week.days[0].extraSessions = [
        { id: "mv", sessionType: "hiit", distanceKm: 8, origin: "moved", movedFrom: "2026-07-14" },
      ];
      const totals = computeRunTotals(week, [], {});
      expect(totals.z2.plannedKm).toBe(10);
      expect(totals.hiit.plannedKm).toBe(8);
      expect(totals.total.plannedKm).toBe(18);
    });

    test("carryover/manual/planner siguen sin sumar a la meta", () => {
      const week = makeWeek([["z2", 10]]);
      week.days[0].extraSessions = [
        { id: "co", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-14" },
        { id: "mn", sessionType: "hiit", distanceKm: 4, origin: "manual" },
        { id: "pl", sessionType: "z2", distanceKm: 3, origin: "planner" },
      ];
      const totals = computeRunTotals(week, [], {});
      expect(totals.total.plannedKm).toBe(10);
      expect(totals.hiit.plannedKm).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// computeStrengthStatus
// ---------------------------------------------------------------------------

describe("computeStrengthStatus", () => {
  const week = makeWeek([
    ["z2", 18, true], // Mon: planned strength
    ["rest", 0, true], // Tue: planned strength
    ["z2", 18], // Wed
  ]);
  const mon = week.days[0].date;
  const wed = week.days[2].date;

  it("marks a day done when a manual strength workout exists", () => {
    const manual: WeekManualWorkout[] = [
      { date: mon, workout_type: "strength", exercises: [{ name: "Sentadilla" }, { name: "Press" }] },
    ];
    const status = computeStrengthStatus(week, manual, []);
    expect(status.days[mon]).toEqual({ planned: true, done: true, exerciseCount: 2 });
    expect(status.days[week.days[1].date]).toEqual({ planned: true, done: false, exerciseCount: 0 });
    expect(status.doneCount).toBe(1);
    expect(status.plannedCount).toBe(2);
  });

  it("marks a day done when weighted sets exist, counting distinct exercises", () => {
    const sets: WeekExerciseSet[] = [
      { date: wed, exercise: "press_banca" },
      { date: wed, exercise: "press_banca" },
      { date: wed, exercise: "peso_muerto" },
    ];
    const status = computeStrengthStatus(week, [], sets);
    // Wed was not planned but got done anyway
    expect(status.days[wed]).toEqual({ planned: false, done: true, exerciseCount: 2 });
    expect(status.doneCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeExerciseTotals
// ---------------------------------------------------------------------------

describe("computeExerciseTotals", () => {
  it("sums weekly reps per exercise and pairs them with goals", () => {
    const week = makeWeek([["z2", 10], ["rest", 0], ["rest", 0]]);
    const logs: WeekExerciseLog[] = [
      { date: week.days[0].date, exercise: "sentadillas", reps: 200 },
      { date: week.days[1].date, exercise: "sentadillas", reps: 200 },
      { date: week.days[1].date, exercise: "barras", reps: 10 },
    ];
    const defs = [
      { exercise_key: "sentadillas", label: "Sentadillas", emoji: "🧎", type: "bodyweight" as const, weekly_goal: 2000, sort_order: 1, is_active: true },
      { exercise_key: "barras", label: "Barras", emoji: "🪂", type: "bodyweight" as const, weekly_goal: null, sort_order: 3, is_active: true },
      { exercise_key: "press_banca", label: "Press Banca", emoji: "🏋️", type: "weighted" as const, weekly_goal: null, sort_order: 5, is_active: true },
    ];
    const totals = computeExerciseTotals(logs, defs);

    expect(totals).toEqual([
      expect.objectContaining({ key: "sentadillas", label: "Sentadillas", emoji: "🧎", reps: 400, goal: 2000 }),
      expect.objectContaining({ key: "barras", label: "Barras", emoji: "🪂", reps: 10, goal: null }),
    ]);
  });

  it("includes bodyweight exercises with a goal even without reps this week", () => {
    const defs = [
      { exercise_key: "planks", label: "Planks", emoji: "🧘", type: "bodyweight" as const, weekly_goal: 20, sort_order: 4, is_active: true },
    ];
    const totals = computeExerciseTotals([], defs);
    expect(totals).toEqual([
      expect.objectContaining({ key: "planks", label: "Planks", emoji: "🧘", reps: 0, goal: 20 }),
    ]);
  });

  it("includes active bodyweight exercises even without reps or goal", () => {
    const defs = [
      { exercise_key: "push_ups", label: "Push Ups", emoji: "💪", type: "bodyweight" as const, weekly_goal: null, sort_order: 2, is_active: true },
      { exercise_key: "inactivo", label: "Inactivo", emoji: "🚫", type: "bodyweight" as const, weekly_goal: null, sort_order: 9, is_active: false },
    ];
    const totals = computeExerciseTotals([], defs);
    expect(totals).toEqual([
      expect.objectContaining({ key: "push_ups", reps: 0, goal: null }),
    ]);
  });

  it("computes per-day reps map for the day boxes", () => {
    const week = makeWeek([["z2", 10], ["rest", 0]]);
    const logs: WeekExerciseLog[] = [
      { date: week.days[0].date, exercise: "sentadillas", reps: 150 },
      { date: week.days[0].date, exercise: "barras", reps: 5 },
    ];
    const defs = [
      { exercise_key: "sentadillas", label: "Sentadillas", emoji: "🧎", type: "bodyweight" as const, weekly_goal: null, sort_order: 1, is_active: true },
      { exercise_key: "barras", label: "Barras", emoji: "🪂", type: "bodyweight" as const, weekly_goal: null, sort_order: 3, is_active: true },
    ];
    const totals = computeExerciseTotals(logs, defs);
    expect(totals.find((t) => t.key === "sentadillas")?.byDate?.[week.days[0].date]).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// computeStepsTotals / formatStepsCompact
// ---------------------------------------------------------------------------

describe("computeStepsTotals", () => {
  it("sums weekly steps and maps them per day", () => {
    const entries: WeekStepsEntry[] = [
      { date: "2026-07-20", steps: 8000 },
      { date: "2026-07-21", steps: 12000 },
      { date: "2026-07-22", steps: null },
    ];
    const totals = computeStepsTotals(entries);
    expect(totals.total).toBe(20000);
    expect(totals.byDate["2026-07-20"]).toBe(8000);
    expect(totals.byDate["2026-07-21"]).toBe(12000);
    expect(totals.byDate["2026-07-22"]).toBe(0);
    expect(totals.goalMin).toBe(WEEKLY_STEPS_GOAL_MIN);
    expect(totals.goalMax).toBe(WEEKLY_STEPS_GOAL_MAX);
  });

  it("defaults the weekly goal to 150k–200k", () => {
    expect(WEEKLY_STEPS_GOAL_MIN).toBe(150000);
    expect(WEEKLY_STEPS_GOAL_MAX).toBe(200000);
  });

  it("aggregates duplicate rows for the same date", () => {
    const entries: WeekStepsEntry[] = [
      { date: "2026-07-20", steps: 5000 },
      { date: "2026-07-20", steps: 3000 },
    ];
    const totals = computeStepsTotals(entries);
    expect(totals.byDate["2026-07-20"]).toBe(8000);
    expect(totals.total).toBe(8000);
  });

  it("returns zeros for an empty week", () => {
    const totals = computeStepsTotals([]);
    expect(totals.total).toBe(0);
    expect(totals.byDate).toEqual({});
  });

  it("accepts a custom goal range", () => {
    const totals = computeStepsTotals([], 70000, 90000);
    expect(totals.goalMin).toBe(70000);
    expect(totals.goalMax).toBe(90000);
  });
});

describe("formatStepsCompact", () => {
  it("keeps values under 1000 as-is", () => {
    expect(formatStepsCompact(0)).toBe("0");
    expect(formatStepsCompact(999)).toBe("999");
  });

  it("formats thousands with one decimal, dropping .0", () => {
    expect(formatStepsCompact(8432)).toBe("8.4k");
    expect(formatStepsCompact(24100)).toBe("24.1k");
    expect(formatStepsCompact(12000)).toBe("12k");
    expect(formatStepsCompact(150000)).toBe("150k");
  });
});

describe("normalizeStepsGoal", () => {
  it("keeps valid integer min/max", () => {
    expect(normalizeStepsGoal(160000, 210000)).toEqual({ min: 160000, max: 210000 });
  });

  it("falls back to defaults for missing values", () => {
    expect(normalizeStepsGoal(undefined, undefined)).toEqual({
      min: WEEKLY_STEPS_GOAL_MIN,
      max: WEEKLY_STEPS_GOAL_MAX,
    });
  });

  it("merges partial updates against a fallback (only min changes)", () => {
    const current = { min: 150000, max: 200000 };
    expect(normalizeStepsGoal(170000, undefined, current)).toEqual({ min: 170000, max: 200000 });
  });

  it("clamps max up to min when max < min", () => {
    expect(normalizeStepsGoal(180000, 120000)).toEqual({ min: 180000, max: 180000 });
  });

  it("rejects zero/negative/NaN and uses the fallback", () => {
    const current = { min: 150000, max: 200000 };
    expect(normalizeStepsGoal(0, -5, current)).toEqual({ min: 150000, max: 200000 });
    expect(normalizeStepsGoal(NaN, "abc", current)).toEqual({ min: 150000, max: 200000 });
  });

  it("parses numeric strings (parseInt truncates decimals)", () => {
    expect(normalizeStepsGoal("155000", "205000.6")).toEqual({ min: 155000, max: 205000 });
  });

  it("rounds numeric (non-string) inputs", () => {
    expect(normalizeStepsGoal(155000.4, 205000.6)).toEqual({ min: 155000, max: 205001 });
  });
});

// ---------------------------------------------------------------------------
// moveSection
// ---------------------------------------------------------------------------

import { moveSection, describeSectionMove } from "@/lib/training/week-tracks";

describe("moveSection — correr", () => {
  test("mismo tipo: el destino suma, el origen queda en 0, totalKm intacto", () => {
    const week = makeWeek([["z2", 10.8], ["z2", 8.2]]);
    moveSection(week, 0, 1, "run");
    expect(week.days[0].distanceKm).toBe(0);
    expect(week.days[0].sessionType).toBe("z2");
    expect(week.days[1].distanceKm).toBe(19);
    expect(week.totalKm).toBe(19);
  });

  test("distinto tipo: extra 'moved' en el destino, el tipo del destino no cambia", () => {
    const week = makeWeek([["hiit", 10], ["z2", 8.2]]);
    moveSection(week, 0, 1, "run");
    expect(week.days[1].sessionType).toBe("z2");
    expect(week.days[1].distanceKm).toBe(8.2);
    expect(week.days[1].extraSessions).toEqual([
      {
        id: "mv-2026-07-13-2026-07-14-hiit",
        sessionType: "hiit",
        distanceKm: 10,
        origin: "moved",
        movedFrom: "2026-07-13",
      },
    ]);
    expect(week.totalKm).toBe(18.2);
    expect(week.z2Km).toBe(8.2);
  });

  test("funde en un chip 'moved' del mismo tipo, no en el principal", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].distanceKm).toBe(8);
    expect(week.days[1].extraSessions).toHaveLength(1);
    expect(week.days[1].extraSessions![0].distanceKm).toBe(15);
  });

  test("al fundir en un chip 'moved' existente, la estrella que trae la sesión pasa al chip (no al día)", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[0].isKeySession = true;
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions![0].isKeySession).toBe(true);
    expect(week.days[1].isKeySession).toBe(false);
    expect(week.days[0].isKeySession).toBe(false);
  });

  test("al fundir en un chip que YA tenía la estrella, la conserva aunque la sesión que llega no traiga una", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11", isKeySession: true },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions![0].isKeySession).toBe(true);
  });

  // Regresión: es un OR que nunca desactiva (`if (session.isKeySession) merged.isKeySession = true`).
  // Con AMBOS lados ya en true, una reescritura a asignación directa
  // (`merged.isKeySession = session.isKeySession`) seguiría pasando este caso
  // puntual, pero junto con el test anterior (destino true / entrante false)
  // deja fijado que el resultado nunca es "el último que llega manda".
  test("al fundir en un chip que YA tenía estrella con una sesión que TAMBIÉN trae estrella, la conserva", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[0].isKeySession = true;
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11", isKeySession: true },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions![0].isKeySession).toBe(true);
  });

  test("al fundir en el principal del destino (mismo tipo), la estrella también viaja", () => {
    const week = makeWeek([["z2", 10], ["z2", 8]]);
    week.days[0].isKeySession = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].distanceKm).toBe(18);
    expect(week.days[1].isKeySession).toBe(true);
    expect(week.days[0].isKeySession).toBe(false);
  });

  test("al fundir en el principal que YA tenía la estrella, la conserva aunque el origen no la traiga", () => {
    const week = makeWeek([["z2", 10], ["z2", 8]]);
    week.days[1].isKeySession = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].isKeySession).toBe(true);
  });

  test("al fundir con un chip 'moved' de OTRO día, limpia movedFrom (no atribuye todo a un solo origen)", () => {
    // El chip existente vino del 2026-07-11; ahora se funde con una sesión
    // que viene del día 0 (2026-07-13). Sin la guarda, movedFrom se quedaría
    // en "2026-07-11" y el chip diría "Movida de 11 jul" conteniendo km de
    // dos días distintos.
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions![0].distanceKm).toBe(15);
    expect(week.days[1].extraSessions![0].origin).toBe("moved");
    expect(week.days[1].extraSessions![0].movedFrom).toBeUndefined();
  });

  test("al fundir con un chip 'moved' del MISMO día de origen, conserva movedFrom", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-13" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions![0].distanceKm).toBe(15);
    expect(week.days[1].extraSessions![0].movedFrom).toBe("2026-07-13");
  });

  test("nunca funde en un carryover del mismo tipo: crea un chip 'moved' aparte", () => {
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "co", sessionType: "hiit", distanceKm: 4, origin: "carryover", carryoverFrom: "2026-07-11" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[1].extraSessions).toHaveLength(2);
    expect(week.days[1].extraSessions![0]).toMatchObject({ id: "co", distanceKm: 4 });
    expect(week.days[1].extraSessions![1]).toMatchObject({ origin: "moved", distanceKm: 5 });
  });

  test("destino vacío (0 km): adopta tipo, zona y notas del origen", () => {
    const week = makeWeek([["hiit", 9], ["z2", 0]]);
    week.days[0].zone = "Z4";
    week.days[0].notes = "8x400";
    moveSection(week, 0, 1, "run");
    expect(week.days[1]).toMatchObject({ sessionType: "hiit", distanceKm: 9, zone: "Z4", notes: "8x400" });
    expect(week.days[1].extraSessions).toBeUndefined();
  });

  // Regresión (mismo espíritu que el caso análogo en merge, arriba): un
  // destino vacío que YA tuviera estrella propia (caso raro, pero el tipo lo
  // permite) no debe perderla al adoptar una sesión que también trae estrella
  // — pin del OR que nunca desactiva en la rama "adopt" de placeSession.
  test("al adoptar un día vacío que YA tenía estrella con una sesión que TAMBIÉN trae estrella, la conserva", () => {
    const week = makeWeek([["hiit", 9], ["z2", 0]]);
    week.days[0].isKeySession = true;
    week.days[1].isKeySession = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].isKeySession).toBe(true);
  });

  test("destino rest con restLocked: adopta y limpia restLocked", () => {
    const week = makeWeek([["z2", 9], ["rest", 0]]);
    week.days[1].restLocked = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].sessionType).toBe("z2");
    expect(week.days[1].distanceKm).toBe(9);
    expect(week.days[1].restLocked).toBeUndefined();
  });

  test("la estrella viaja al destino y el origen la pierde", () => {
    const week = makeWeek([["long_run", 16], ["z2", 0]]);
    week.days[0].isKeySession = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].isKeySession).toBe(true);
    expect(week.days[0].isKeySession).toBe(false);
  });

  // CAMBIO DE COMPORTAMIENTO DELIBERADO (decisión de producto, 2026-08-04):
  // esta prueba antes afirmaba que la estrella caía en el DÍA destino incluso
  // cuando la sesión aterrizaba como chip nuevo (rama 4/new_box). Se cambia a
  // propósito, no para "hacerla pasar": la decisión del dueño del repo es que
  // la estrella viaja con el TRABAJO, y en new_box el trabajo es el chip, no
  // el día que lo hospeda (que puede tener su propia sesión sin relación con
  // la que acaba de llegar). Ver ExtraSession.isKeySession.
  test("la estrella viaja al chip nuevo (rama 4, extra nuevo), no al día destino", () => {
    const week = makeWeek([["hiit", 10], ["z2", 8.2]]);
    week.days[0].isKeySession = true;
    moveSection(week, 0, 1, "run");
    expect(week.days[1].isKeySession).toBe(false);
    expect(week.days[1].extraSessions).toHaveLength(1);
    expect(week.days[1].extraSessions![0].isKeySession).toBe(true);
    expect(week.days[0].isKeySession).toBe(false);
  });

  test("el origen conserva sessionType y zone, y limpia notes", () => {
    const week = makeWeek([["hiit", 9], ["z2", 8]]);
    week.days[0].zone = "Z4";
    week.days[0].notes = "8x400";
    moveSection(week, 0, 1, "run");
    expect(week.days[0]).toMatchObject({ sessionType: "hiit", zone: "Z4", notes: "", distanceKm: 0 });
  });

  test("no toca los extras preexistentes del origen", () => {
    const week = makeWeek([["z2", 9], ["z2", 8]]);
    week.days[0].extraSessions = [
      { id: "co", sessionType: "z2", distanceKm: 3, origin: "carryover", carryoverFrom: "2026-07-11" },
    ];
    moveSection(week, 0, 1, "run");
    expect(week.days[0].extraSessions).toEqual([
      { id: "co", sessionType: "z2", distanceKm: 3, origin: "carryover", carryoverFrom: "2026-07-11" },
    ]);
  });

  test("no-op: origen vacío, mismo índice o índice inválido", () => {
    const week = makeWeek([["z2", 0], ["z2", 8]]);
    moveSection(week, 0, 1, "run");
    expect(week.days[1].distanceKm).toBe(8);
    moveSection(week, 1, 1, "run");
    expect(week.days[1].distanceKm).toBe(8);
    moveSection(week, 1, 9, "run");
    expect(week.days[1].distanceKm).toBe(8);
  });

  test("no-op: día legacy sin normalizar (sessionType 'strength', km > 0)", () => {
    const week = makeWeek([["z2", 9], ["z2", 5]]);
    week.days[0].sessionType = "strength";
    moveSection(week, 0, 1, "run");
    expect(week.days[0].distanceKm).toBe(9);
    expect(week.days[1].distanceKm).toBe(5);
    expect(week.days[1].extraSessions).toBeUndefined();
  });

  test("cualquier día a cualquier día: 0→6, 6→0 y 5→1 sin adyacencia", () => {
    const week = makeWeek(
      Array.from({ length: 7 }, () => ["z2", 5] as [SessionType, number])
    );
    moveSection(week, 0, 6, "run");
    expect(week.days[6].distanceKm).toBe(10);
    expect(week.days[0].distanceKm).toBe(0);
    moveSection(week, 6, 0, "run");
    expect(week.days[0].distanceKm).toBe(10);
    expect(week.days[6].distanceKm).toBe(0);
    moveSection(week, 5, 1, "run");
    expect(week.days[1].distanceKm).toBe(10);
    expect(week.totalKm).toBe(35);
  });
});

describe("moveSection — fuerza", () => {
  test("a un día sin fuerza: se mueve 1:1 y strengthSessions no cambia", () => {
    const week = makeWeek([["z2", 5, true], ["z2", 5]]);
    moveSection(week, 0, 1, "strength");
    expect(week.days[0].strengthDay).toBe(false);
    expect(week.days[1].strengthDay).toBe(true);
    expect(week.strengthSessions).toBe(1);
  });

  test("a un día que ya tiene fuerza: se funde y la semana baja de 2 a 1", () => {
    const week = makeWeek([["z2", 5, true], ["z2", 5, true]]);
    moveSection(week, 0, 1, "strength");
    expect(week.days[1].strengthDay).toBe(true);
    expect(week.strengthSessions).toBe(1);
  });

  test("no-op si el origen no tiene fuerza", () => {
    const week = makeWeek([["z2", 5], ["z2", 5]]);
    moveSection(week, 0, 1, "strength");
    expect(week.days[1].strengthDay).toBeFalsy();
  });

  test("no toca los km al mover fuerza", () => {
    const week = makeWeek([["z2", 7, true], ["z2", 5]]);
    moveSection(week, 0, 1, "strength");
    expect(week.days[0].distanceKm).toBe(7);
    expect(week.days[1].distanceKm).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// describeSectionMove
// ---------------------------------------------------------------------------

describe("describeSectionMove", () => {
  test("mismo tipo → merge, confirma, resultKm sumado", () => {
    const week = makeWeek([["z2", 10.8], ["z2", 8.2]]);
    expect(describeSectionMove(week, 0, 1, "run")).toEqual({
      section: "run",
      kind: "merge",
      needsConfirm: true,
      fromLabel: "Lun 13",
      toLabel: "Mar 14",
      sessionType: "z2",
      fromKm: 10.8,
      targetKm: 8.2,
      resultKm: 19,
    });
  });

  test("funde en un chip 'moved' existente: targetKm/resultKm salen del chip, no del principal", () => {
    // El destino (día 1, z2) NO tiene hiit como principal — el merge cae en
    // el extra "moved" que ya trae; targetKm/resultKm deben reflejar los km
    // de ESE chip (10), no los del box principal (8, de otro tipo).
    const week = makeWeek([["hiit", 5], ["z2", 8]]);
    week.days[1].extraSessions = [
      { id: "mv-old", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-11" },
    ];
    const info = describeSectionMove(week, 0, 1, "run")!;
    expect(info.kind).toBe("merge");
    expect(info.needsConfirm).toBe(true);
    expect(info.sessionType).toBe("hiit");
    expect(info.fromKm).toBe(5);
    expect(info.targetKm).toBe(10);
    expect(info.resultKm).toBe(15);
  });

  test("distinto tipo con destino ocupado → new_box, no confirma", () => {
    const week = makeWeek([["hiit", 10], ["z2", 8.2]]);
    const info = describeSectionMove(week, 0, 1, "run")!;
    expect(info.kind).toBe("new_box");
    expect(info.needsConfirm).toBe(false);
    expect(info.sessionType).toBe("hiit");
    expect(info.targetKm).toBe(0);
    expect(info.resultKm).toBe(10);
  });

  test("destino vacío o rest → adopt, no confirma", () => {
    const week = makeWeek([["hiit", 10], ["z2", 0], ["rest", 0]]);
    expect(describeSectionMove(week, 0, 1, "run")!.kind).toBe("adopt");
    expect(describeSectionMove(week, 0, 1, "run")!.needsConfirm).toBe(false);
    expect(describeSectionMove(week, 0, 2, "run")!.kind).toBe("adopt");
  });

  test("el sessionType devuelto es siempre el del origen", () => {
    const week = makeWeek([["long_run", 16], ["z2", 8]]);
    expect(describeSectionMove(week, 0, 1, "run")!.sessionType).toBe("long_run");
  });

  test("salto largo 0→6: las etiquetas salen de los días correctos", () => {
    const week = makeWeek(
      Array.from({ length: 7 }, () => ["z2", 5] as [SessionType, number])
    );
    const info = describeSectionMove(week, 0, 6, "run")!;
    expect(info.fromLabel).toBe("Lun 13");
    expect(info.toLabel).toBe("Dom 19");
  });

  test("fuerza: confirma solo si el destino ya la tiene", () => {
    const week = makeWeek([["z2", 5, true], ["z2", 5], ["z2", 5, true]]);
    expect(describeSectionMove(week, 0, 1, "strength")!.needsConfirm).toBe(false);
    expect(describeSectionMove(week, 0, 1, "strength")!.kind).toBe("adopt");
    expect(describeSectionMove(week, 0, 2, "strength")!.needsConfirm).toBe(true);
    expect(describeSectionMove(week, 0, 2, "strength")!.kind).toBe("merge");
  });

  test("no-op → null", () => {
    const week = makeWeek([["z2", 0], ["z2", 8]]);
    expect(describeSectionMove(week, 0, 1, "run")).toBeNull();
    expect(describeSectionMove(week, 1, 1, "run")).toBeNull();
    expect(describeSectionMove(week, 1, 9, "run")).toBeNull();
    expect(describeSectionMove(week, 1, 0, "strength")).toBeNull();
  });

  test("no-op: día legacy sin normalizar (sessionType 'strength', km > 0) — hereda la guarda de moveSection", () => {
    const week = makeWeek([["z2", 9], ["z2", 5]]);
    week.days[0].sessionType = "strength";
    expect(describeSectionMove(week, 0, 1, "run")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describeExtraMove — misma decisión (merge/adopt/new_box) que
// describeSectionMove, pero para mover un chip suelto (regresión 2026-08-04:
// mover un chip debe pedir confirmación cuando funde, igual que mover la caja
// principal).
// ---------------------------------------------------------------------------

import { describeExtraMove } from "@/lib/training/week-tracks";

describe("describeExtraMove", () => {
  test("mismo tipo con km en el destino → merge, confirma", () => {
    const week = makeWeek([["z2", 10], ["z2", 8]]);
    const extra: ExtraSession = { id: "mv-1", sessionType: "z2", distanceKm: 5, origin: "moved", movedFrom: "2026-07-10" };
    const info = describeExtraMove(week.days[0], week.days[1], extra);
    expect(info.section).toBe("run");
    expect(info.kind).toBe("merge");
    expect(info.needsConfirm).toBe(true);
    expect(info.sessionType).toBe("z2");
    expect(info.fromKm).toBe(5);
    expect(info.targetKm).toBe(8);
    expect(info.resultKm).toBe(13);
  });

  test("destino vacío (0 km) → adopt, no confirma", () => {
    const week = makeWeek([["z2", 10], ["z2", 0]]);
    const extra: ExtraSession = { id: "m1", sessionType: "hiit", distanceKm: 4, origin: "manual" };
    const info = describeExtraMove(week.days[0], week.days[1], extra);
    expect(info.kind).toBe("adopt");
    expect(info.needsConfirm).toBe(false);
  });

  test("distinto tipo con destino ocupado → new_box, no confirma", () => {
    const week = makeWeek([["hiit", 10], ["z2", 8]]);
    const extra: ExtraSession = { id: "m1", sessionType: "long_run", distanceKm: 4, origin: "planner" };
    const info = describeExtraMove(week.days[0], week.days[1], extra);
    expect(info.kind).toBe("new_box");
    expect(info.needsConfirm).toBe(false);
  });

  test("un carryover NUNCA pide confirmación, aunque el destino coincida en tipo (nunca se funde)", () => {
    const week = makeWeek([["z2", 10], ["z2", 8]]);
    const extra: ExtraSession = { id: "co", sessionType: "z2", distanceKm: 3, origin: "carryover", carryoverFrom: "2026-07-10" };
    const info = describeExtraMove(week.days[0], week.days[1], extra);
    expect(info.kind).toBe("new_box");
    expect(info.needsConfirm).toBe(false);
  });

  test("las etiquetas salen de fromDay/toDay, no de índices de semana", () => {
    const week = makeWeek([["z2", 10], ["z2", 8], ["hiit", 5]]);
    const extra: ExtraSession = { id: "m1", sessionType: "hiit", distanceKm: 4, origin: "manual" };
    const info = describeExtraMove(week.days[0], week.days[2], extra);
    expect(info.fromLabel).toBe("Lun 13");
    expect(info.toLabel).toBe("Mié 15");
  });
});
