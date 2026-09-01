import {
  NONE_REF,
  MAIN_REF,
  daySessionSlots,
  assignRuns,
  sessionActuals,
  assignedAggregate,
  applyRunOverride,
  pruneRunOverrides,
  runsBySlot,
  nextRunRef,
  partitionExtrasForDisplay,
  isEasyRun,
  Z2_BONUS_REF,
  type AssignableRun,
} from "@/lib/training/run-assignment";
import type { GeneratedDay, SessionType } from "@/lib/training/plan-generator-types";

function makeDay(sessionType: SessionType, distanceKm: number): GeneratedDay {
  return {
    date: "2026-07-21",
    dayOfWeek: 1,
    dayLabel: "Mar",
    sessionType,
    distanceKm,
    zone: sessionType === "hiit" ? "Z4-Z5" : "Z2",
    notes: "",
    isKeySession: false,
  };
}

function run(
  id: number,
  km: number,
  opts: { minPerKm?: number; avgHr?: number; maxHr?: number } = {}
): AssignableRun {
  const meters = km * 1000;
  return {
    activity_id: id,
    distance_meters: meters,
    duration_seconds: opts.minPerKm ? Math.round(km * opts.minPerKm * 60) : null,
    avg_hr: opts.avgHr ?? null,
    max_hr: opts.maxHr ?? null,
  };
}

describe("daySessionSlots", () => {
  test("principal primero, luego extras en orden", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    const slots = daySessionSlots(day);
    expect(slots.map((s) => s.ref)).toEqual([MAIN_REF, "x1"]);
    expect(slots[0]).toMatchObject({ sessionType: "hiit", distanceKm: 9.4, isExtra: false });
    expect(slots[1]).toMatchObject({ sessionType: "z2", distanceKm: 11, isExtra: true });
  });

  test("día rest sin extras no tiene slots; rest con extras solo extras", () => {
    expect(daySessionSlots(makeDay("rest", 0))).toEqual([]);
    const day = makeDay("rest", 0);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 5, origin: "manual" }];
    expect(daySessionSlots(day).map((s) => s.ref)).toEqual(["x1"]);
  });

  test("día no-rest con 0 km sigue exponiendo el slot principal", () => {
    const day = makeDay("z2", 0);
    expect(daySessionSlots(day).map((s) => s.ref)).toEqual([MAIN_REF]);
    expect(daySessionSlots(day)[0]).toMatchObject({ sessionType: "z2", distanceKm: 0, isExtra: false });
  });

  test("una carrera en un día vaciado se asigna al principal, no a excluidas", () => {
    const day = makeDay("z2", 0);
    expect(assignRuns(day, [run(1, 8.2)])).toEqual({ 1: MAIN_REF });
  });
});

describe("assignRuns — auto", () => {
  test("una sola sesión: todas las carreras a ella (dos Z2 se suman)", () => {
    const day = makeDay("z2", 25.2);
    const a = assignRuns(day, [run(1, 10), run(2, 11.2)]);
    expect(a).toEqual({ 1: MAIN_REF, 2: MAIN_REF });
  });

  test("sin slots (rest sin extras): todas a none", () => {
    const day = makeDay("rest", 0);
    expect(assignRuns(day, [run(1, 5)])).toEqual({ 1: NONE_REF });
  });

  test("1 carrera + varias sesiones: cercanía de distancia (caso martes)", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    // 7.4 km: |7.4-9.4|=2 < |7.4-11|=3.6 → HIIT
    expect(assignRuns(day, [run(1, 7.4)])).toEqual({ 1: MAIN_REF });
    // 10.8 km: más cerca del Z2 de 11
    expect(assignRuns(day, [run(2, 10.8)])).toEqual({ 2: "x1" });
  });

  test("2 carreras, HIIT + Z2: los picos de FC deciden (spread max-avg)", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    // run 1: suave (spread 10); run 2: intervalos (spread 45) → run 2 es el HIIT
    const a = assignRuns(day, [
      run(1, 11, { avgHr: 130, maxHr: 140 }),
      run(2, 9, { avgHr: 150, maxHr: 195 }),
    ]);
    expect(a).toEqual({ 1: "x1", 2: MAIN_REF });
  });

  test("sin FC, el ritmo decide: la carrera más rápida es el HIIT", () => {
    const day = makeDay("z2", 19.7);
    day.extraSessions = [{ id: "h1", sessionType: "hiit", distanceKm: 9.4, origin: "planner" }];
    const a = assignRuns(day, [
      run(1, 10, { minPerKm: 7.5 }),
      run(2, 9, { minPerKm: 5.5 }),
    ]);
    expect(a).toEqual({ 1: MAIN_REF, 2: "h1" });
  });

  test("3 carreras, 1 HIIT + 1 Z2: la más intensa al HIIT, el resto al Z2", () => {
    const day = makeDay("hiit", 10);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 20, origin: "manual" }];
    const a = assignRuns(day, [
      run(1, 8, { avgHr: 128, maxHr: 142 }),
      run(2, 9, { avgHr: 155, maxHr: 198 }),
      run(3, 12, { avgHr: 131, maxHr: 144 }),
    ]);
    expect(a).toEqual({ 1: "x1", 2: MAIN_REF, 3: "x1" });
  });

  test("varias carreras sin sesión HIIT: cercanía de distancia por carrera", () => {
    const day = makeDay("z2", 10);
    day.extraSessions = [{ id: "x1", sessionType: "long_run", distanceKm: 30, origin: "manual" }];
    const a = assignRuns(day, [run(1, 9), run(2, 28)]);
    expect(a).toEqual({ 1: MAIN_REF, 2: "x1" });
  });

  test("determinista: mismo input, misma salida (empate → orden cronológico/slots)", () => {
    const day = makeDay("z2", 10);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 10, origin: "manual" }];
    const runs = [run(2, 10), run(1, 10)];
    const a1 = assignRuns(day, runs);
    const a2 = assignRuns(day, [...runs].reverse());
    expect(a1).toEqual(a2);
    // empate exacto de distancia → gana el primer slot (main)
    expect(a1[1]).toBe(MAIN_REF);
  });
});

describe("assignRuns — un slot de 0 km no compite por carreras", () => {
  test("un slot de 0 km no le roba la carrera a un extra que sí espera trabajo", () => {
    const day = makeDay("z2", 0);
    day.extraSessions = [{ id: "m1", sessionType: "z2", distanceKm: 5, origin: "manual" }];
    expect(assignRuns(day, [run(1, 1.2)])).toEqual({ 1: "m1" });
  });

  test("un slot de 0 km no apaga la rama de solo calidad (hiit extra)", () => {
    const day = makeDay("z2", 0);
    day.extraSessions = [{ id: "h1", sessionType: "hiit", distanceKm: 9, origin: "planner" }];
    const runs = [run(1, 6, { avgHr: 120, maxHr: 140 })];
    const a = assignRuns(day, runs);
    expect(a[1]).toBe(Z2_BONUS_REF);
    const act = sessionActuals(day, runs);
    expect(act.extras["h1"]).toBe(0);
    expect(act.bonusZ2).toBeCloseTo(6, 1);
  });
});

describe("assignRuns — overrides", () => {
  test("el override manual gana al auto", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    day.runOverrides = { "1": "x1" };
    // el auto habría dicho MAIN (7.4 más cerca de 9.4), pero Jorge dijo Z2
    expect(assignRuns(day, [run(1, 7.4)])).toEqual({ 1: "x1" });
  });

  test("override none excluye la carrera", () => {
    const day = makeDay("z2", 20);
    day.runOverrides = { "2": NONE_REF };
    expect(assignRuns(day, [run(1, 18), run(2, 3)])).toEqual({ 1: MAIN_REF, 2: NONE_REF });
  });

  test("override huérfano (extra borrado) se ignora y cae al auto", () => {
    const day = makeDay("z2", 20);
    day.runOverrides = { "1": "x-borrado" };
    expect(assignRuns(day, [run(1, 18)])).toEqual({ 1: MAIN_REF });
  });
});

describe("sessionActuals", () => {
  test("suma por cuadrito; sin overshoot que chorree", () => {
    const day = makeDay("z2", 25.2);
    const s = sessionActuals(day, [run(1, 10), run(2, 11.2)]);
    expect(s.main).toBeCloseTo(21.2, 1);
    expect(s.assignments).toEqual({ 1: MAIN_REF, 2: MAIN_REF });
  });

  test("la sesión sin carreras asignadas marca 0 (no null) cuando el día sí tuvo carreras", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    const s = sessionActuals(day, [run(1, 7.4)]);
    expect(s.main).toBeCloseTo(7.4, 1);
    expect(s.extras["x1"]).toBe(0);
  });

  test("sin carreras y sin fallback: todo null", () => {
    const day = makeDay("z2", 20);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 5, origin: "manual" }];
    const s = sessionActuals(day, []);
    expect(s.main).toBeNull();
    expect(s.extras["x1"]).toBeNull();
  });

  test("fallback legacy (actual guardado sin actividades): todo al primer slot", () => {
    const day = makeDay("z2", 20);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 5, origin: "manual" }];
    const s = sessionActuals(day, [], 22);
    expect(s.main).toBeCloseTo(22, 1);
    expect(s.extras["x1"]).toBe(0);
  });

  test("carrera excluida (none) no suma a nadie", () => {
    const day = makeDay("z2", 20);
    day.runOverrides = { "2": NONE_REF };
    const s = sessionActuals(day, [run(1, 18), run(2, 3)]);
    expect(s.main).toBeCloseTo(18, 1);
  });
});

describe("assignedAggregate", () => {
  test("agrega solo las asignadas; la más larga es la principal; ritmo ponderado", () => {
    const day = makeDay("z2", 25);
    day.runOverrides = { "3": NONE_REF };
    const agg = assignedAggregate(day, [
      run(1, 10, { minPerKm: 7 }),
      run(2, 11.2, { minPerKm: 7.6 }),
      run(3, 2, { minPerKm: 9 }),
    ]);
    expect(agg).not.toBeNull();
    expect(agg!.matchedActivityId).toBe(2);
    expect(agg!.actualDistanceKm).toBeCloseTo(21.2, 1);
    expect(agg!.activityIds.sort()).toEqual([1, 2]);
    // ponderado: (10*7 + 11.2*7.6) / 21.2 ≈ 7.32
    expect(agg!.actualPace).toBeCloseTo(7.32, 1);
  });

  test("todas excluidas o sin carreras → null", () => {
    const day = makeDay("z2", 20);
    expect(assignedAggregate(day, [])).toBeNull();
    day.runOverrides = { "1": NONE_REF };
    expect(assignedAggregate(day, [run(1, 5)])).toBeNull();
  });
});

describe("applyRunOverride / pruneRunOverrides", () => {
  test("acepta refs válidos (main, extraId, none) y rechaza inválidos", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    expect(applyRunOverride(day, 123, "x1").ok).toBe(true);
    expect(applyRunOverride(day, 124, MAIN_REF).ok).toBe(true);
    expect(applyRunOverride(day, 125, NONE_REF).ok).toBe(true);
    expect(day.runOverrides).toEqual({ "123": "x1", "124": MAIN_REF, "125": NONE_REF });
    expect(applyRunOverride(day, 126, "no-existe").ok).toBe(false);
    expect(applyRunOverride(day, "abc", MAIN_REF).ok).toBe(false);
    expect(day.runOverrides).toEqual({ "123": "x1", "124": MAIN_REF, "125": NONE_REF });
  });

  test("pruneRunOverrides tira refs huérfanos y limpia el objeto vacío", () => {
    const day = makeDay("z2", 20);
    day.runOverrides = { "1": MAIN_REF, "2": "x-borrado" };
    pruneRunOverrides(day);
    expect(day.runOverrides).toEqual({ "1": MAIN_REF });
    day.sessionType = "rest";
    day.distanceKm = 0;
    pruneRunOverrides(day);
    expect(day.runOverrides).toBeUndefined();
  });
});

describe("runsBySlot", () => {
  test("agrupa varias carreras en su sesión asignada, cronológicas", () => {
    const day = makeDay("z2", 25.2);
    const r1 = run(2, 11.2, { minPerKm: 7.6 });
    const r2 = run(1, 10, { minPerKm: 7.1 });
    const g = runsBySlot(day, [r1, r2]);
    expect(g.byRef[MAIN_REF].map((r) => r.activity_id)).toEqual([1, 2]);
    expect(g.excluded).toEqual([]);
  });

  test("separa por slot (HIIT vs Z2 extra) y aparta las excluidas", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    day.runOverrides = { "3": NONE_REF };
    const hiit = run(1, 7.4, { minPerKm: 8.3, avgHr: 130, maxHr: 175 });
    const easy = run(2, 11, { minPerKm: 7.5, avgHr: 128, maxHr: 140 });
    const walk = run(3, 2);
    const g = runsBySlot(day, [hiit, easy, walk]);
    expect(g.byRef[MAIN_REF].map((r) => r.activity_id)).toEqual([1]);
    expect(g.byRef["x1"].map((r) => r.activity_id)).toEqual([2]);
    expect(g.excluded.map((r) => r.activity_id)).toEqual([3]);
  });

  test("día sin carreras: grupos vacíos por slot y sin excluidas", () => {
    const day = makeDay("z2", 20);
    const g = runsBySlot(day, []);
    expect(g.byRef).toEqual({ [MAIN_REF]: [] });
    expect(g.excluded).toEqual([]);
  });
});

describe("nextRunRef", () => {
  test("cicla principal → extras → none → principal", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "x1", sessionType: "z2", distanceKm: 11, origin: "carryover" }];
    expect(nextRunRef(day, MAIN_REF)).toBe("x1");
    expect(nextRunRef(day, "x1")).toBe(NONE_REF);
    expect(nextRunRef(day, NONE_REF)).toBe(MAIN_REF);
  });

  test("ref huérfano cae al primer slot; día sin slots regresa none", () => {
    const day = makeDay("z2", 20);
    expect(nextRunRef(day, "x-borrado")).toBe(MAIN_REF);
    expect(nextRunRef(day, MAIN_REF)).toBe(NONE_REF);
    expect(nextRunRef(makeDay("rest", 0), NONE_REF)).toBe(NONE_REF);
  });
});

describe("partitionExtrasForDisplay", () => {
  test("un carryover del MISMO tipo que la sesión principal se funde (folded)", () => {
    const day = makeDay("z2", 20);
    day.extraSessions = [
      { id: "co1", sessionType: "z2", distanceKm: 4.7, origin: "carryover", carryoverFrom: "2026-07-20" },
    ];
    const { folded, chips } = partitionExtrasForDisplay(day);
    expect(folded).toHaveLength(1);
    expect(folded[0].id).toBe("co1");
    expect(chips).toHaveLength(0);
  });

  test("un carryover de OTRO tipo cae a chips (no se funde)", () => {
    const day = makeDay("hiit", 10);
    day.extraSessions = [
      { id: "co1", sessionType: "z2", distanceKm: 4.7, origin: "carryover", carryoverFrom: "x" },
    ];
    const { folded, chips } = partitionExtrasForDisplay(day);
    expect(folded).toHaveLength(0);
    expect(chips.map((e) => e.id)).toEqual(["co1"]);
  });

  test("extras manual/planner siempre van a chips, aunque sean del mismo tipo", () => {
    const day = makeDay("z2", 20);
    day.extraSessions = [
      { id: "m1", sessionType: "z2", distanceKm: 5, origin: "manual" },
      { id: "p1", sessionType: "z2", distanceKm: 3, origin: "planner" },
      { id: "co1", sessionType: "z2", distanceKm: 4, origin: "carryover", carryoverFrom: "x" },
    ];
    const { folded, chips } = partitionExtrasForDisplay(day);
    expect(folded.map((e) => e.id)).toEqual(["co1"]);
    expect(chips.map((e) => e.id).sort()).toEqual(["m1", "p1"]);
  });

  test("un día rest / 0 km no funde nada (todo a chips)", () => {
    const day = makeDay("rest", 0);
    day.extraSessions = [
      { id: "co1", sessionType: "z2", distanceKm: 4, origin: "carryover", carryoverFrom: "x" },
    ];
    const { folded, chips } = partitionExtrasForDisplay(day);
    expect(folded).toHaveLength(0);
    expect(chips).toHaveLength(1);
  });

  test("sin extras devuelve arrays vacíos", () => {
    const { folded, chips } = partitionExtrasForDisplay(makeDay("z2", 20));
    expect(folded).toEqual([]);
    expect(chips).toEqual([]);
  });
});

describe("clasificación por intensidad (2º entrenamiento suave = Z2)", () => {
  test("isEasyRun: swing de FC bajo = fácil; alto = calidad; sin FC = no fácil", () => {
    expect(isEasyRun(run(1, 5, { avgHr: 116, maxHr: 137 }))).toBe(true); // spread 21
    expect(isEasyRun(run(2, 7, { avgHr: 130, maxHr: 168 }))).toBe(false); // spread 38
    expect(isEasyRun(run(3, 5))).toBe(false); // sin FC → no se marca fácil
  });

  test("día HIIT con 2ª carrera suave: la intensa cubre el HIIT, la suave → Z2 bonus", () => {
    const day = makeDay("hiit", 9.4);
    const runs = [run(1, 7.4, { avgHr: 130, maxHr: 168 }), run(2, 5, { avgHr: 116, maxHr: 137 })];
    const a = assignRuns(day, runs);
    expect(a[1]).toBe(MAIN_REF);
    expect(a[2]).toBe(Z2_BONUS_REF);
    const act = sessionActuals(day, runs);
    expect(act.main).toBeCloseTo(7.4, 1);
    expect(act.bonusZ2).toBeCloseTo(5, 1);
  });

  test("día HIIT con una sola carrera de calidad: cubre el HIIT (sin bonus)", () => {
    const day = makeDay("hiit", 9.4);
    const act = sessionActuals(day, [run(1, 9.6, { avgHr: 132, maxHr: 174 })]);
    expect(act.main).toBeCloseTo(9.6, 1);
    expect(act.bonusZ2).toBe(0);
  });

  test("día HIIT con una sola carrera suave: NO cubre el HIIT, cuenta como Z2 bonus", () => {
    const day = makeDay("hiit", 9.4);
    const act = sessionActuals(day, [run(1, 6, { avgHr: 120, maxHr: 140 })]); // spread 20
    expect(act.main).toBe(0);
    expect(act.bonusZ2).toBeCloseTo(6, 1);
  });

  test("dos HIIT slots (main + carryover) con 2 carreras: la suave sigue siendo Z2 bonus", () => {
    const day = makeDay("hiit", 9.4);
    day.extraSessions = [{ id: "co1", sessionType: "hiit", distanceKm: 2, origin: "carryover", carryoverFrom: "x" }];
    const runs = [run(1, 9.6, { avgHr: 132, maxHr: 174 }), run(2, 1.5, { avgHr: 128, maxHr: 146 })];
    const act = sessionActuals(day, runs);
    expect(act.main).toBeCloseTo(9.6, 1); // la intensa cubre el HIIT principal
    expect(act.extras["co1"]).toBe(0); // el carryover HIIT queda sin cubrir
    expect(act.bonusZ2).toBeCloseTo(1.5, 1); // la suave → Z2
  });

  test("runsBySlot separa las carreras Z2 bonus", () => {
    const day = makeDay("hiit", 9.4);
    const runs = [run(1, 7.4, { avgHr: 130, maxHr: 168 }), run(2, 5, { avgHr: 116, maxHr: 137 })];
    const { byRef, bonusZ2 } = runsBySlot(day, runs);
    expect(byRef[MAIN_REF].map((r) => r.activity_id)).toEqual([1]);
    expect(bonusZ2.map((r) => r.activity_id)).toEqual([2]);
  });

  test("día Z2 con 2 carreras: ambas cuentan Z2 (aunque una tenga swing alto, sin falso HIIT)", () => {
    const day = makeDay("z2", 20);
    const runs = [run(1, 10, { avgHr: 140, maxHr: 175 }), run(2, 11, { avgHr: 130, maxHr: 150 })];
    const a = assignRuns(day, runs);
    expect(a[1]).toBe(MAIN_REF);
    expect(a[2]).toBe(MAIN_REF);
    expect(sessionActuals(day, runs).bonusZ2).toBe(0);
  });

  test("un override manual gana sobre la clasificación (fuerza la suave al HIIT)", () => {
    const day = makeDay("hiit", 9.4);
    day.runOverrides = { "2": MAIN_REF };
    const runs = [run(1, 7.4, { avgHr: 130, maxHr: 168 }), run(2, 5, { avgHr: 116, maxHr: 137 })];
    const a = assignRuns(day, runs);
    expect(a[2]).toBe(MAIN_REF); // el override respeta la decisión del usuario
  });
});
