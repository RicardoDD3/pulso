import {
  applyCarryover,
  carryoverKey,
  dayTargetKm,
  replaceDayExtras,
  retypeExtraSessions,
  moveExtraBetweenDays,
  proportionalSplit,
  MIN_CARRYOVER_KM,
} from "@/lib/training/carryover";
import { moveSection, recalcWeekAggregates } from "@/lib/training/week-tracks";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
  Phase,
  ExtraSession,
} from "@/lib/training/plan-generator-types";
import type { AssignableRun } from "@/lib/training/run-assignment";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function makeDay(
  date: string,
  dayOfWeek: number,
  sessionType: SessionType,
  distanceKm: number
): GeneratedDay {
  return {
    date,
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek],
    sessionType,
    distanceKm,
    zone: sessionType === "z2" ? "Z2" : sessionType === "hiit" ? "Z4-Z5" : "",
    notes: "",
    isKeySession: false,
  };
}

/** Semana Lun-Dom empezando en startDate (debe ser lunes). */
function makeWeek(
  weekNumber: number,
  startDate: string,
  sessions: Array<[SessionType, number]>,
  phase: Phase = "build"
): GeneratedWeek {
  const start = new Date(startDate + "T00:00:00Z");
  const days = sessions.map(([type, km], i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return makeDay(d.toISOString().slice(0, 10), i, type, km);
  });
  const totalKm = days.reduce((s, d) => s + d.distanceKm, 0);
  return {
    weekNumber,
    phase,
    mesoWeek: 1,
    weekStartDate: startDate,
    totalKm,
    z2Km: days.filter((d) => d.sessionType === "z2").reduce((s, d) => s + d.distanceKm, 0),
    longRunPlusB2bKm: 0,
    days,
    strengthSessions: 0,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
  };
}

function makePlan(weeks: GeneratedWeek[], raceDate = "2099-12-31"): GeneratedPlan {
  return {
    raceDistanceKm: 100,
    raceDate,
    planWeeks: weeks.length,
    peakWeeklyKm: 100,
    currentWeeklyKm: 80,
    startDate: weeks[0].weekStartDate,
    weeks,
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: { exercises: [], basePhaseFrequency: "", buildPeakFrequency: "", taperFrequency: "" },
  };
}

/** Una carrera Garmin simple del día (sin FC, ritmo neutro). */
let nextActivityId = 1;
function ran(date: string, km: number): [string, AssignableRun[]] {
  return [
    date,
    [
      {
        activity_id: nextActivityId++,
        distance_meters: km * 1000,
        duration_seconds: null,
        avg_hr: null,
        max_hr: null,
      },
    ],
  ];
}
function runsMap(...entries: Array<[string, AssignableRun[]]>): Record<string, AssignableRun[]> {
  return Object.fromEntries(entries);
}

// Semana estándar: Lun Z2 20, Mar HIIT 12, Mié Z2 20, Jue Z2 24, Vie Z2 20, Sáb long 38, Dom Z2 10
const WEEK_SESSIONS: Array<[SessionType, number]> = [
  ["z2", 20],
  ["hiit", 12],
  ["z2", 20],
  ["z2", 24],
  ["z2", 20],
  ["long_run", 38],
  ["z2", 10],
];

// Semana con DOS días HIIT (Mar/Jue) para probar el routing por tipo:
// Lun z2 20, Mar hiit 12, Mié z2 20, Jue hiit 10, Vie z2 24, Sáb long 38, Dom z2 10
// z2: 0,2,4,6 · hiit: 1,3 · long: 5
const WK: Array<[SessionType, number]> = [
  ["z2", 20],
  ["hiit", 12],
  ["z2", 20],
  ["hiit", 10],
  ["z2", 24],
  ["long_run", 38],
  ["z2", 10],
];

/** Suma de todos los km de carryover del plan (para chequear conservación). */
function totalCarryover(plan: GeneratedPlan): number {
  return Math.round(
    plan.weeks
      .flatMap((w) => w.days)
      .flatMap((d) => (d.extraSessions ?? []).filter((e) => e.origin === "carryover"))
      .reduce((s, e) => s + e.distanceKm, 0) * 10
  ) / 10;
}
const carryOf = (plan: GeneratedPlan, wi: number, di: number) =>
  (plan.weeks[wi].days[di].extraSessions ?? []).filter((e) => e.origin === "carryover");

// ---------------------------------------------------------------------------
// proportionalSplit
// ---------------------------------------------------------------------------

describe("proportionalSplit", () => {
  test("reparte proporcional a los pesos y conserva el total", () => {
    expect(proportionalSplit(6, [30, 10])).toEqual([4.5, 1.5]);
  });
  test("un solo destino recibe todo", () => {
    expect(proportionalSplit(4, [10])).toEqual([4]);
  });
  test("pesos iguales → partes iguales", () => {
    expect(proportionalSplit(5, [10, 10])).toEqual([2.5, 2.5]);
  });
  test("total 0 o sin pesos positivos → ceros", () => {
    expect(proportionalSplit(0, [10, 20])).toEqual([0, 0]);
    expect(proportionalSplit(5, [0, 0])).toEqual([0, 0]);
  });
  test("el residuo de redondeo va al mayor peso y la suma cuadra", () => {
    const out = proportionalSplit(5, [20, 24, 10]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(5, 5);
    expect(out[1]).toBeGreaterThanOrEqual(out[0]); // 24 >= 20
    expect(out[1]).toBeGreaterThanOrEqual(out[2]); // 24 >= 10
  });
});

// ---------------------------------------------------------------------------
// applyCarryover — reparto proporcional por tipo, dentro de la semana
// ---------------------------------------------------------------------------

describe("applyCarryover — reparto proporcional", () => {
  // z2: Lun(12), Mié(30), Vie(10). Tras Lun quedan Mié(30) y Vie(10) → 3:1.
  const WP: Array<[SessionType, number]> = [
    ["z2", 12], ["hiit", 8], ["z2", 30], ["hiit", 8], ["z2", 10], ["long_run", 30], ["rest", 0],
  ];

  test("Z2 corto se reparte PROPORCIONAL entre los próximos Z2 (grande absorbe más)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WP)]);
    // Lun z2 12, corrió 4 → faltan 8 → Mié(30) 6, Vie(10) 2 (proporción 3:1)
    const changed = applyCarryover(plan, runsMap(ran("2026-07-20", 4)), "2026-07-21");

    expect(changed).toBe(true);
    expect(carryOf(plan, 0, 1)).toHaveLength(0); // Mar (hiit) intacto
    expect(carryOf(plan, 0, 2)[0].distanceKm).toBeCloseTo(6, 1); // Mié
    expect(carryOf(plan, 0, 4)[0].distanceKm).toBeCloseTo(2, 1); // Vie
    for (const di of [2, 4]) {
      expect(carryOf(plan, 0, di)[0].sessionType).toBe("z2");
      expect(carryOf(plan, 0, di)[0].carryoverFrom).toBe("2026-07-20");
    }
    expect(totalCarryover(plan)).toBeCloseTo(8, 1); // conserva el faltante
  });

  test("HIIT corto se reparte PROPORCIONAL entre los próximos HIIT (conserva tipo)", () => {
    // hiit: Lun(10), Mié(6), Vie(14). Tras Lun: Mié(6), Vie(14) → 3:7.
    const wp: Array<[SessionType, number]> = [
      ["hiit", 10], ["z2", 15], ["hiit", 6], ["z2", 15], ["hiit", 14], ["long_run", 30], ["rest", 0],
    ];
    const plan = makePlan([makeWeek(1, "2026-07-20", wp)]);
    const changed = applyCarryover(plan, {}, "2026-07-21"); // Lun hiit 10 perdido → falta 10

    expect(changed).toBe(true);
    expect(carryOf(plan, 0, 2)[0].sessionType).toBe("hiit");
    expect(carryOf(plan, 0, 2)[0].distanceKm).toBeCloseTo(3, 1); // Mié(6)
    expect(carryOf(plan, 0, 4)[0].sessionType).toBe("hiit");
    expect(carryOf(plan, 0, 4)[0].distanceKm).toBeCloseTo(7, 1); // Vie(14)
    expect(totalCarryover(plan)).toBeCloseTo(10, 1);
  });

  test("un solo próximo del tipo recibe todo el faltante", () => {
    // z2: Lun(20), Jue(15). Tras Lun solo queda Jue.
    const wp: Array<[SessionType, number]> = [
      ["z2", 20], ["hiit", 10], ["hiit", 10], ["z2", 15], ["long_run", 30], ["rest", 0], ["rest", 0],
    ];
    const plan = makePlan([makeWeek(1, "2026-07-20", wp)]);
    applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21"); // falta 5

    expect(carryOf(plan, 0, 3)).toHaveLength(1);
    expect(carryOf(plan, 0, 3)[0].distanceKm).toBeCloseTo(5, 1);
  });

  test("faltante menor al umbral (2 km) no genera carryover", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    expect(applyCarryover(plan, runsMap(ran("2026-07-20", 18.5)), "2026-07-21")).toBe(false);
  });

  test("los días de hoy en adelante no generan carryover", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    expect(applyCarryover(plan, {}, "2026-07-20")).toBe(false);
  });

  test("día rest no genera carryover", () => {
    const sessions: Array<[SessionType, number]> = [["rest", 0], ...WK.slice(1)];
    const plan = makePlan([makeWeek(1, "2026-07-20", sessions)]);
    expect(applyCarryover(plan, {}, "2026-07-21")).toBe(false);
  });

  test("día que sí cumplió no genera carryover", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    expect(applyCarryover(plan, runsMap(ran("2026-07-20", 21)), "2026-07-21")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyCarryover — encadenado (cobertura) y descarte por fin de semana
// ---------------------------------------------------------------------------

describe("applyCarryover — encadenado", () => {
  // z2 iguales para verificar re-reparto: Lun(10), Mié(10), Vie(10).
  const WE: Array<[SessionType, number]> = [
    ["z2", 10], ["hiit", 8], ["z2", 10], ["hiit", 8], ["z2", 10], ["long_run", 30], ["rest", 0],
  ];

  test("lo no cubierto en un día pasado se re-reparte a los siguientes del tipo (cobertura)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WE)]);
    // Lun perdido (falta 10) → Mié 5, Vie 5. Mié corre 10 (cubre su main, NO el
    // pendiente de 5) → ese 5 re-fluye a Vie: Vie termina con 10, todo del lunes.
    const runs = runsMap(ran("2026-07-21", 8), ran("2026-07-22", 10), ran("2026-07-23", 8));
    applyCarryover(plan, runs, "2026-07-24");

    const fromLun = carryOf(plan, 0, 4).filter((e) => e.carryoverFrom === "2026-07-20");
    expect(fromLun.reduce((s, e) => s + e.distanceKm, 0)).toBeCloseTo(10, 1);
    expect(carryOf(plan, 0, 2)).toHaveLength(0); // Mié no conserva pendiente
    expect(totalCarryover(plan)).toBeCloseTo(10, 1); // se conserva, no se duplica
  });

  test("cubrir el pendiente en el día que lo recibe lo extingue (no re-fluye)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WE)]);
    // Lun perdido (10) → Mié 5, Vie 5. Mié corre DOS carreras (10 al main + 5 al
    // pendiente) → cubre su porción; solo la de Vie (5) sobrevive.
    const runs = runsMap(ran("2026-07-21", 8), ran("2026-07-23", 8));
    runs["2026-07-22"] = [
      { activity_id: 901, distance_meters: 10000, duration_seconds: null, avg_hr: null, max_hr: null },
      { activity_id: 902, distance_meters: 5000, duration_seconds: null, avg_hr: null, max_hr: null },
    ];
    applyCarryover(plan, runs, "2026-07-24");

    expect(totalCarryover(plan)).toBeCloseTo(5, 1); // 5 cubierto en Mié, 5 vivo
    expect(carryOf(plan, 0, 2)).toHaveLength(0);
    expect(carryOf(plan, 0, 4).reduce((s, e) => s + e.distanceKm, 0)).toBeCloseTo(5, 1);
  });

  test("dos días del mismo tipo cortos acumulan en los siguientes, con su origen", () => {
    // z2: Lun(10), Mié(10), Vie(20). Lun y Mié perdidos → ambos van a Vie (único z2 restante).
    const wp: Array<[SessionType, number]> = [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["hiit", 8], ["z2", 20], ["long_run", 30], ["rest", 0],
    ];
    const plan = makePlan([makeWeek(1, "2026-07-20", wp)]);
    const runs = runsMap(ran("2026-07-21", 8), ran("2026-07-23", 8)); // solo hiit
    applyCarryover(plan, runs, "2026-07-24");

    const cos = carryOf(plan, 0, 4);
    expect(cos.map((e) => e.carryoverFrom).sort()).toEqual(["2026-07-20", "2026-07-22"]);
    expect(cos.reduce((s, e) => s + e.distanceKm, 0)).toBeCloseTo(20, 1);
  });

  test("HIIT corto sin más HIIT en la semana → se descarta", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    // Jue (último hiit) perdido; Lun/Mar/Mié completos → no hay hiit después
    const runs = runsMap(ran("2026-07-20", 20), ran("2026-07-21", 12), ran("2026-07-22", 20));
    const changed = applyCarryover(plan, runs, "2026-07-24");

    expect(changed).toBe(false);
    expect(totalCarryover(plan)).toBe(0);
  });

  test("long run corto se descarta (no hay otro long en la semana)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    const entries = plan.weeks[0].days.map((d) => ran(d.date, d.distanceKm));
    entries[5] = ran("2026-07-25", 30); // Sáb long corto 8
    expect(applyCarryover(plan, runsMap(...entries), "2026-07-26")).toBe(false);
  });

  test("NO cruza de semana: Dom Z2 corto se descarta aunque la semana siguiente tenga Z2", () => {
    const plan = makePlan([
      makeWeek(1, "2026-07-20", WK),
      makeWeek(2, "2026-07-27", WK),
    ]);
    const entries = plan.weeks[0].days.map((d) => ran(d.date, d.distanceKm));
    entries[6] = ran("2026-07-26", 5); // Dom z2 corto 5, último día de la semana
    const changed = applyCarryover(plan, runsMap(...entries), "2026-07-27");

    expect(carryOf(plan, 1, 0)).toHaveLength(0);
    expect(totalCarryover(plan)).toBe(0);
    expect(changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyCarryover — idempotencia, descartes, manual, race
// ---------------------------------------------------------------------------

describe("applyCarryover — recálculo", () => {
  test("idempotente: correrlo dos veces no duplica", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    const matches = runsMap(ran("2026-07-20", 15));
    applyCarryover(plan, matches, "2026-07-21");
    const snapshot = JSON.stringify(plan);
    const changedAgain = applyCarryover(plan, matches, "2026-07-21");

    expect(changedAgain).toBe(false);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  test("si el actual sube en un re-sync, el pendiente total baja", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    applyCarryover(plan, runsMap(ran("2026-07-20", 10)), "2026-07-21");
    expect(totalCarryover(plan)).toBeCloseTo(10, 1);

    // Segunda corrida del lunes sube el total a 15 → el pendiente baja a 5
    const changed = applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21");
    expect(changed).toBe(true);
    expect(totalCarryover(plan)).toBeCloseTo(5, 1);
  });

  test("un carryover descartado por el usuario no revive", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    plan.weeks[0].days[2].carryoverDismissed = [carryoverKey("2026-07-20", "z2")];

    const changed = applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21");
    expect(changed).toBe(false);
    expect(totalCarryover(plan)).toBe(0);
  });

  test("los extras manual y planner sobreviven al recálculo", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    const wed = plan.weeks[0].days[2]; // recibe una porción del pendiente del lunes
    wed.extraSessions = [
      { id: "m1", sessionType: "z2", distanceKm: 6, origin: "manual" },
      { id: "p1", sessionType: "hiit", distanceKm: 3, origin: "planner" },
    ];
    applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21");

    const origins = wed.extraSessions!.map((e) => e.origin).sort();
    expect(origins).toEqual(["carryover", "manual", "planner"]);
  });

  test("un extra manual HIIT no cubierto se reparte a los próximos HIIT (conserva HIIT)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    const monday = plan.weeks[0].days[0];
    monday.extraSessions = [{ id: "m1", sessionType: "hiit", distanceKm: 5, origin: "manual" }];
    // Corrió 20 → cubre z2, falta el hiit de 5 → repartido entre los hiit (Mar, Jue)
    applyCarryover(plan, runsMap(ran("2026-07-20", 20)), "2026-07-21");

    const marHiit = carryOf(plan, 0, 1).filter((e) => e.sessionType === "hiit");
    const jueHiit = carryOf(plan, 0, 3).filter((e) => e.sessionType === "hiit");
    expect(marHiit.length + jueHiit.length).toBeGreaterThan(0);
    expect(totalCarryover(plan)).toBeCloseTo(5, 1);
    expect(monday.extraSessions!.some((e) => e.id === "m1")).toBe(true); // el manual sigue
  });

  test("no genera carryover en una semana race", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK, "race")]);
    expect(applyCarryover(plan, runsMap(ran("2026-07-20", 5)), "2026-07-22")).toBe(false);
  });

  test("una carrera excluida por override no cubre nada (genera carryover)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    plan.weeks[0].days[0].runOverrides = { "77": "none" };
    const changed = applyCarryover(
      plan,
      { "2026-07-20": [{ activity_id: 77, distance_meters: 20000, duration_seconds: null, avg_hr: null, max_hr: null }] },
      "2026-07-21"
    );
    expect(changed).toBe(true);
    expect(totalCarryover(plan)).toBeCloseTo(20, 1);
  });

  test("el último día de la semana corto descarta el faltante (no hay siguiente del tipo)", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WK)]);
    const entries = plan.weeks[0].days.map((d) => ran(d.date, d.distanceKm));
    entries[6] = ran("2026-07-26", 5); // Dom z2 corto, último día
    expect(applyCarryover(plan, runsMap(...entries), "2026-07-28")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dayTargetKm / carryoverKey
// ---------------------------------------------------------------------------

describe("helpers", () => {
  test("dayTargetKm suma principal + extras", () => {
    const day = makeDay("2026-07-20", 0, "z2", 20);
    expect(dayTargetKm(day)).toBe(20);
    day.extraSessions = [
      { id: "a", sessionType: "hiit", distanceKm: 4, origin: "carryover" },
      { id: "b", sessionType: "z2", distanceKm: 6, origin: "manual" },
    ];
    expect(dayTargetKm(day)).toBe(30);
  });

  test("carryoverKey es estable", () => {
    expect(carryoverKey("2026-07-20", "z2")).toBe("2026-07-20:z2");
  });

  test("MIN_CARRYOVER_KM es 2", () => {
    expect(MIN_CARRYOVER_KM).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// replaceDayExtras — CRUD desde /day y el chat Planes
// ---------------------------------------------------------------------------

describe("replaceDayExtras", () => {
  test("agrega extras válidos, normalizando km y generando id si falta", () => {
    const day = makeDay("2026-07-20", 0, "z2", 20);
    const res = replaceDayExtras(day, [
      { sessionType: "hiit", distanceKm: 5.234, origin: "manual" },
      { id: "p9", sessionType: "z2", distanceKm: 6, origin: "planner" },
    ]);

    expect(res.ok).toBe(true);
    expect(day.extraSessions).toHaveLength(2);
    expect(day.extraSessions![0].distanceKm).toBe(5.2);
    expect(day.extraSessions![0].id).toBeTruthy();
    expect(day.extraSessions![1].id).toBe("p9");
  });

  test("rechaza tipos de sesión o km inválidos", () => {
    const day = makeDay("2026-07-20", 0, "z2", 20);
    expect(replaceDayExtras(day, [{ sessionType: "yoga", distanceKm: 5 }]).ok).toBe(false);
    expect(replaceDayExtras(day, [{ sessionType: "z2", distanceKm: 0 }]).ok).toBe(false);
    expect(replaceDayExtras(day, [{ sessionType: "z2", distanceKm: -3 }]).ok).toBe(false);
    expect(replaceDayExtras(day, "nope").ok).toBe(false);
    expect(day.extraSessions).toBeUndefined();
  });

  test("quitar un carryover registra el descarte para que el sync no lo reviva", () => {
    const day = makeDay("2026-07-21", 1, "hiit", 12);
    day.extraSessions = [
      { id: "co-2026-07-20-z2", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-20" },
      { id: "m1", sessionType: "z2", distanceKm: 4, origin: "manual" },
    ];
    const res = replaceDayExtras(day, [
      { id: "m1", sessionType: "z2", distanceKm: 4, origin: "manual" },
    ]);

    expect(res.ok).toBe(true);
    expect(day.extraSessions).toHaveLength(1);
    expect(day.carryoverDismissed).toEqual([carryoverKey("2026-07-20", "z2")]);
  });

  test("array vacío limpia los extras del día", () => {
    const day = makeDay("2026-07-20", 0, "z2", 20);
    day.extraSessions = [{ id: "m1", sessionType: "z2", distanceKm: 4, origin: "manual" }];
    const res = replaceDayExtras(day, []);

    expect(res.ok).toBe(true);
    expect(day.extraSessions).toBeUndefined();
  });

  test("origin inválido o ausente cae a manual", () => {
    const day = makeDay("2026-07-20", 0, "z2", 20);
    replaceDayExtras(day, [{ sessionType: "z2", distanceKm: 5, origin: "hacker" }]);
    expect(day.extraSessions![0].origin).toBe("manual");
  });

  test("un origin ausente hereda el de un extra existente con el mismo id (no lo degrada a manual)", () => {
    // Round-trip del chat Planes: el LLM re-emite el array de extras del día
    // sin incluir "origin" (el prompt no lo mencionaba para "moved"). Antes,
    // esto degradaba el extra a "manual" y sus km desaparecían de la meta
    // semanal (moved es el único origin que suma). Ahora hereda del existente.
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    day.extraSessions = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ];
    const res = replaceDayExtras(day, [{ id: "mv-1", sessionType: "hiit", distanceKm: 10 }]);

    expect(res).toEqual({ ok: true });
    expect(day.extraSessions).toEqual([
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ]);
  });

  test("un origin explícito distinto SÍ se respeta (no hereda del existente)", () => {
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    day.extraSessions = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ];
    const res = replaceDayExtras(day, [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "planner" },
    ]);

    expect(res).toEqual({ ok: true });
    expect(day.extraSessions![0].origin).toBe("planner");
    expect(day.extraSessions![0].movedFrom).toBeUndefined();
  });

  test("un extra con isKeySession true reenviado tal cual conserva la estrella", () => {
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    const res = replaceDayExtras(day, [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20", isKeySession: true },
    ]);

    expect(res).toEqual({ ok: true });
    expect(day.extraSessions![0].isKeySession).toBe(true);
  });

  test("una estrella se hereda del existente con el mismo id cuando el input la omite (round-trip del chat Planes)", () => {
    // Mismo escenario que el origin ausente: el chat Planes reemite el array
    // COMPLETO de extras del día, y el prompt no le pide al LLM incluir
    // isKeySession — omitirlo no debe borrar la estrella del chip.
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    day.extraSessions = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20", isKeySession: true },
    ];
    const res = replaceDayExtras(day, [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ]);

    expect(res).toEqual({ ok: true });
    expect(day.extraSessions![0].isKeySession).toBe(true);
  });

  test("un extra sin estrella no la gana de la nada", () => {
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    const res = replaceDayExtras(day, [
      { id: "m1", sessionType: "hiit", distanceKm: 10, origin: "manual" },
    ]);

    expect(res).toEqual({ ok: true });
    expect(day.extraSessions![0].isKeySession).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// retypeExtraSessions — cambiar el tipo de un cuadrito extra (chip)
// ---------------------------------------------------------------------------

describe("retypeExtraSessions", () => {
  test("un extra manual cambia de tipo en su lugar (mismo id/origen)", () => {
    const extras = [
      { id: "m1", sessionType: "z2" as const, distanceKm: 6, origin: "manual" as const },
    ];
    const out = retypeExtraSessions(extras, "m1", "hiit");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: "m1", sessionType: "hiit", distanceKm: 6, origin: "manual" });
  });

  test("un extra planner también se puede re-tipar (a long run)", () => {
    const extras = [
      { id: "p1", sessionType: "hiit" as const, distanceKm: 4, origin: "planner" as const },
    ];
    const out = retypeExtraSessions(extras, "p1", "long_run");
    expect(out[0].sessionType).toBe("long_run");
    expect(out[0].origin).toBe("planner");
    expect(out[0].id).toBe("p1");
  });

  test("un carryover se convierte en manual (id nuevo, sin carryoverFrom)", () => {
    const extras = [
      { id: "co-2026-07-22-z2", sessionType: "z2" as const, distanceKm: 4.7, origin: "carryover" as const, carryoverFrom: "2026-07-22" },
    ];
    const out = retypeExtraSessions(extras, "co-2026-07-22-z2", "hiit");
    expect(out).toHaveLength(1);
    expect(out[0].origin).toBe("manual");
    expect(out[0].sessionType).toBe("hiit");
    expect(out[0].distanceKm).toBeCloseTo(4.7, 1);
    expect(out[0].carryoverFrom).toBeUndefined();
    expect(out[0].id).not.toBe("co-2026-07-22-z2");
  });

  test("un carryover con estrella (defensivo: hoy no ocurre en la práctica) la conserva al convertirse en manual", () => {
    const extras: ExtraSession[] = [
      { id: "co-2026-07-22-z2", sessionType: "z2", distanceKm: 4.7, origin: "carryover", carryoverFrom: "2026-07-22", isKeySession: true },
    ];
    const out = retypeExtraSessions(extras, "co-2026-07-22-z2", "hiit");
    expect(out[0].isKeySession).toBe(true);
  });

  test("elegir el mismo tipo es no-op (un carryover NO se convierte a manual)", () => {
    const extras = [
      { id: "co-1", sessionType: "z2" as const, distanceKm: 5, origin: "carryover" as const, carryoverFrom: "x" },
    ];
    const out = retypeExtraSessions(extras, "co-1", "z2");
    expect(out[0].origin).toBe("carryover");
    expect(out[0].id).toBe("co-1");
  });

  test("id inexistente o tipo inválido → array sin cambios", () => {
    const extras = [
      { id: "m1", sessionType: "z2" as const, distanceKm: 6, origin: "manual" as const },
    ];
    expect(retypeExtraSessions(extras, "no-existe", "hiit")[0].sessionType).toBe("z2");
    expect(retypeExtraSessions(extras, "m1", "yoga" as never)[0].sessionType).toBe("z2");
  });

  test("no muta el array/objeto de entrada", () => {
    const extras = [
      { id: "m1", sessionType: "z2" as const, distanceKm: 6, origin: "manual" as const },
    ];
    const snapshot = JSON.stringify(extras);
    retypeExtraSessions(extras, "m1", "hiit");
    expect(JSON.stringify(extras)).toBe(snapshot);
  });

  test("re-tipar un carryover + guardar (replaceDayExtras) descarta el pendiente original", () => {
    const day = makeDay("2026-07-23", 3, "hiit", 9.4);
    day.extraSessions = [
      { id: "co-2026-07-22-z2", sessionType: "z2", distanceKm: 4.7, origin: "carryover", carryoverFrom: "2026-07-22" },
    ];
    const res = replaceDayExtras(day, retypeExtraSessions(day.extraSessions, "co-2026-07-22-z2", "long_run"));

    expect(res.ok).toBe(true);
    expect(day.extraSessions).toHaveLength(1);
    expect(day.extraSessions![0].origin).toBe("manual");
    expect(day.extraSessions![0].sessionType).toBe("long_run");
    expect(day.carryoverDismissed).toEqual([carryoverKey("2026-07-22", "z2")]);
  });

  test("el sync (applyCarryover) NO revive un carryover re-tipado a mano", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", WEEK_SESSIONS)]);
    // Lun z2 20, corrió 15 → pendiente z2 5 al próximo z2 (Mié, día 2)
    applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21");
    const wed = plan.weeks[0].days[2];
    const co = wed.extraSessions!.find((e) => e.origin === "carryover")!;

    // El usuario lo re-tipa a HIIT (se convierte en manual)
    const res = replaceDayExtras(wed, retypeExtraSessions(wed.extraSessions!, co.id, "hiit"));
    expect(res.ok).toBe(true);
    expect(wed.extraSessions![0].origin).toBe("manual");
    expect(wed.extraSessions![0].sessionType).toBe("hiit");

    // Re-sync con el mismo faltante: no revive el pendiente z2, el manual sobrevive
    applyCarryover(plan, runsMap(ran("2026-07-20", 15)), "2026-07-21");
    expect(wed.extraSessions!.filter((e) => e.origin === "carryover")).toHaveLength(0);
    expect(wed.extraSessions!.some((e) => e.origin === "manual" && e.sessionType === "hiit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// moveExtraBetweenDays — arrastrar un cuadrito extra a otro día
// ---------------------------------------------------------------------------

describe("moveExtraBetweenDays", () => {
  function planWithExtras() {
    // Semana Lun-Dom; el Mar tiene un carryover y el Jue un extra manual.
    const week = makeWeek(1, "2026-07-20", [
      ["z2", 10], ["z2", 8], ["hiit", 6], ["z2", 12], ["z2", 8], ["long_run", 20], ["z2", 6],
    ]);
    week.days[1].extraSessions = [
      { id: "co-2026-07-19-z2", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-19" },
    ];
    week.days[3].extraSessions = [
      { id: "m1", sessionType: "hiit", distanceKm: 4, origin: "manual" },
    ];
    return makePlan([week]);
  }

  test("mueve un extra manual: sale del origen y entra al destino", () => {
    const plan = planWithExtras();
    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 3 }, { weekIndex: 0, dayIndex: 5 }, "m1");
    expect(res.ok).toBe(true);
    expect(plan.weeks[0].days[3].extraSessions).toBeUndefined();
    const dst = plan.weeks[0].days[5].extraSessions!;
    expect(dst).toHaveLength(1);
    expect(dst[0].sessionType).toBe("hiit");
    expect(dst[0].distanceKm).toBe(4);
    expect(dst[0].origin).toBe("manual");
  });

  test("un carryover movido se convierte en manual y queda descartado en el origen", () => {
    const plan = planWithExtras();
    const from = plan.weeks[0].days[1];
    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 4 }, "co-2026-07-19-z2");
    expect(res.ok).toBe(true);
    // Salió del origen y quedó descartado para que el sync no lo reviva.
    expect(from.extraSessions).toBeUndefined();
    expect(from.carryoverDismissed).toContain(carryoverKey("2026-07-19", "z2"));
    // En el destino vive como manual (fuera del ciclo de recálculo del sync).
    const dst = plan.weeks[0].days[4].extraSessions!;
    expect(dst).toHaveLength(1);
    expect(dst[0].origin).toBe("manual");
    expect(dst[0].distanceKm).toBe(5);
    expect(dst[0].carryoverFrom).toBeUndefined();
  });

  test("el sync (applyCarryover) NO revive un carryover que se movió a mano", () => {
    const plan = planWithExtras();
    moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 4 }, "co-2026-07-19-z2");
    // El faltante del 19 (que originó el carryover) sigue existiendo; el sync
    // recomputa pero el descarte impide recrearlo en su día calculado.
    applyCarryover(plan, {}, "2026-08-01");
    const anyRevived = plan.weeks[0].days.some((d) =>
      (d.extraSessions ?? []).some((e) => e.origin === "carryover" && e.carryoverFrom === "2026-07-19")
    );
    expect(anyRevived).toBe(false);
    // El manual movido sobrevive el sync.
    const moved = plan.weeks[0].days[4].extraSessions ?? [];
    expect(moved.some((e) => e.origin === "manual" && e.distanceKm === 5)).toBe(true);
  });

  test("preserva los demás extras del día destino (append, no replace)", () => {
    const plan = planWithExtras();
    plan.weeks[0].days[5].extraSessions = [
      { id: "keep", sessionType: "z2", distanceKm: 3, origin: "manual" },
    ];
    moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 3 }, { weekIndex: 0, dayIndex: 5 }, "m1");
    const dst = plan.weeks[0].days[5].extraSessions!;
    expect(dst).toHaveLength(2);
    expect(dst.map((e) => e.id)).toContain("keep");
  });

  test("rechaza índices o id inválidos sin mutar", () => {
    const plan = planWithExtras();
    expect(moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 9, dayIndex: 0 }, "co-2026-07-19-z2").ok).toBe(false);
    expect(moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 4 }, "no-existe").ok).toBe(false);
    expect(moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 1 }, "co-2026-07-19-z2").ok).toBe(false);
    // el extra del Mar sigue intacto
    expect(plan.weeks[0].days[1].extraSessions).toHaveLength(1);
  });
});

describe("extras origin 'moved'", () => {
  test("replaceDayExtras conserva origin 'moved' y movedFrom", () => {
    const day = makeDay("2026-07-21", 1, "z2", 8.2);
    const res = replaceDayExtras(day, [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ]);
    expect(res).toEqual({ ok: true });
    expect(day.extraSessions).toEqual([
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ]);
  });

  test("retypeExtraSessions sobre un 'moved' conserva el origin (no lo vuelve manual)", () => {
    const extras: ExtraSession[] = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
    ];
    const next = retypeExtraSessions(extras, "mv-1", "z2");
    expect(next[0]).toMatchObject({ id: "mv-1", sessionType: "z2", origin: "moved" });
  });

  test("applyCarryover conserva los extras 'moved' (solo borra los carryover)", () => {
    // 2026-07-20 es lunes. Semana con dos Z2; el martes lleva un extra movido
    // y un carryover: el recálculo debe borrar solo el segundo.
    const plan = makePlan([makeWeek(1, "2026-07-20", [["z2", 10], ["z2", 10]])]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-20" },
      { id: "co-1", sessionType: "z2", distanceKm: 3, origin: "carryover", carryoverFrom: "2026-07-20" },
    ];
    applyCarryover(plan, {}, "2026-07-27");
    const ids = (plan.weeks[0].days[1].extraSessions ?? []).map((e) => e.id);
    expect(ids).toContain("mv-1");
    expect(ids).not.toContain("co-1");
  });

  test("moveExtraBetweenDays conserva origin 'moved' y movedFrom al arrastrar el chip a otro día", () => {
    const plan = makePlan([makeWeek(1, "2026-07-20", [["z2", 10], ["z2", 10]])]);
    const day0 = plan.weeks[0].days[0];
    day0.extraSessions = [
      { id: "mv-1", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: day0.date },
    ];

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 0 }, { weekIndex: 0, dayIndex: 1 }, "mv-1");

    expect(res).toEqual({ ok: true });
    expect(plan.weeks[0].days[0].extraSessions).toBeUndefined();
    const dst = plan.weeks[0].days[1].extraSessions ?? [];
    expect(dst).toHaveLength(1);
    expect(dst[0]).toMatchObject({ sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: day0.date });
  });
});

// ---------------------------------------------------------------------------
// moveExtraBetweenDays — mismas reglas de colocación que moveSection
// (regresión 2026-08-04: arrastrar un chip de vuelta a un día vaciado debía
// ADOPTARLO, no apilarse encima; ver design doc del bug de mover chips).
// ---------------------------------------------------------------------------

describe("moveExtraBetweenDays — mismas reglas que moveSection (merge/adopt/new_box)", () => {
  test("un chip 'moved' que aterriza en un día con el MISMO tipo se funde en el principal", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["hiit", 5], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    // Mar (índice 1) trae un chip z2 "moved" (simulando una sesión ya movida antes).
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "z2", distanceKm: 6, origin: "moved", movedFrom: "2026-08-02" },
    ];

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 0 }, "mv-x");

    expect(res.ok).toBe(true);
    expect(plan.weeks[0].days[0].distanceKm).toBe(16); // 10 (Lun) + 6 fundido en el principal
    expect(plan.weeks[0].days[0].extraSessions).toBeUndefined();
    expect(plan.weeks[0].days[1].extraSessions).toBeUndefined(); // salió del origen
  });

  test("un chip 'moved' que aterriza en un día vacío (0 km) ADOPTA el día, no crea un chip aparte", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 0], ["z2", 10], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "long_run", distanceKm: 12, origin: "moved", movedFrom: "2026-08-01" },
    ];

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 2 }, "mv-x");

    expect(res.ok).toBe(true);
    const day2 = plan.weeks[0].days[2];
    expect(day2.sessionType).toBe("long_run");
    expect(day2.distanceKm).toBe(12);
    expect(day2.extraSessions).toBeUndefined();
  });

  test("un chip 'moved' recalcula los agregados de la semana tras fundirse (el total no cambia: ya contaba)", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["z2", 10], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "z2", distanceKm: 6, origin: "moved", movedFrom: "2026-08-02" },
    ];
    recalcWeekAggregates(plan.weeks[0]); // refleja el chip recién agregado a mano
    const totalAntes = plan.weeks[0].totalKm;
    const z2Antes = plan.weeks[0].z2Km;

    moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 0 }, "mv-x");

    // El chip "moved" ya sumaba al total y a z2Km ANTES de fundirse (regla:
    // "moved" es el único origin que cuenta hacia la meta semanal); fundirlo
    // en el principal solo cambia DÓNDE viven esos km, no cuánto suman.
    expect(plan.weeks[0].totalKm).toBe(totalAntes);
    expect(plan.weeks[0].z2Km).toBe(z2Antes);
    expect(plan.weeks[0].days[0].distanceKm).toBe(16); // 10 + 6 fundidos
  });

  test("viaje de ida y vuelta: mover el long run del sábado al jueves y el chip de vuelta deja el plan idéntico al inicial", () => {
    // Lun z2 10, Mar hiit 8, Mié z2 10, Jue z2 7.1, Vie z2 10, Sáb long_run 16, Dom z2 6.
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["z2", 7.1], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    // makeWeek no calcula longRunPlusB2bKm (queda en 0 por construcción); se
    // recalcula antes de tomar la foto "antes" para que el round-trip compare
    // contra el estado real, no contra un agregado que nunca se computó.
    recalcWeekAggregates(plan.weeks[0]);
    const before = JSON.parse(JSON.stringify(plan));

    // 1) Arrastra el cuadrito de correr del Sábado (índice 5) al Jueves (índice 3):
    //    Jueves no es del mismo tipo (z2 vs long_run) → nace un chip "moved".
    moveSection(plan.weeks[0], 5, 3, "run");
    expect(plan.weeks[0].days[5].distanceKm).toBe(0); // sanity: el Sábado quedó vacío
    const extraId = plan.weeks[0].days[3].extraSessions![0].id;

    // 2) Arrastra ESE chip de vuelta al Sábado, que ya quedó vacío (0 km).
    const res = moveExtraBetweenDays(
      plan,
      { weekIndex: 0, dayIndex: 3 },
      { weekIndex: 0, dayIndex: 5 },
      extraId
    );

    expect(res.ok).toBe(true);
    expect(plan).toEqual(before);
  });

  test("viaje de ida y vuelta CON estrella: la sesión clave vuelve exactamente igual (día → chip → día)", () => {
    // Mismo escenario que el test anterior, pero el long run del Sábado es la
    // sesión clave de la semana: debe volver íntegro (tipo, km Y estrella).
    // Caso de punta a punta pedido por el dueño del repo (decisión de
    // producto 2026-08-04): la estrella viaja con el trabajo, no con el día.
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["z2", 7.1], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    week.days[5].isKeySession = true;
    const plan = makePlan([week]);
    recalcWeekAggregates(plan.weeks[0]);
    const before = JSON.parse(JSON.stringify(plan));

    // 1) Sábado (estrella) → Jueves: tipos distintos → nace un chip "moved"
    //    que se lleva la estrella; el Sábado queda vacío y sin estrella; el
    //    Jueves (día destino) NO la recibe, porque el trabajo cayó en un chip.
    moveSection(plan.weeks[0], 5, 3, "run");
    expect(plan.weeks[0].days[5].isKeySession).toBe(false);
    expect(plan.weeks[0].days[3].isKeySession).toBe(false);
    const extraId = plan.weeks[0].days[3].extraSessions![0].id;
    expect(plan.weeks[0].days[3].extraSessions![0].isKeySession).toBe(true);

    // 2) El chip de vuelta al Sábado, que quedó vacío: lo adopta con todo y
    //    estrella incluida.
    const res = moveExtraBetweenDays(
      plan,
      { weekIndex: 0, dayIndex: 3 },
      { weekIndex: 0, dayIndex: 5 },
      extraId
    );

    expect(res.ok).toBe(true);
    expect(plan.weeks[0].days[5].isKeySession).toBe(true);
    expect(plan).toEqual(before);
  });
});

describe("moveExtraBetweenDays — la estrella de sesión clave viaja con el chip", () => {
  test("un chip con estrella que aterriza como cuadrito nuevo lleva la estrella consigo, no el día destino", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["z2", 10], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "long_run", distanceKm: 12, origin: "moved", movedFrom: "2026-08-01", isKeySession: true },
    ];

    // Día 0 es z2 (tipo distinto a long_run) → new_box.
    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 0 }, "mv-x");

    expect(res.ok).toBe(true);
    const day0 = plan.weeks[0].days[0];
    expect(day0.isKeySession).toBe(false);
    expect(day0.extraSessions).toHaveLength(1);
    expect(day0.extraSessions![0].isKeySession).toBe(true);
  });

  test("un chip con estrella que se funde con el principal del destino deja la estrella en el día", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 10], ["z2", 10], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "z2", distanceKm: 6, origin: "moved", movedFrom: "2026-08-02", isKeySession: true },
    ];

    // Día 0 es z2 (mismo tipo) → merge en el principal.
    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 0 }, "mv-x");

    expect(res.ok).toBe(true);
    expect(plan.weeks[0].days[0].distanceKm).toBe(16);
    expect(plan.weeks[0].days[0].isKeySession).toBe(true);
  });

  test("un chip con estrella que ADOPTA un día vacío deja la estrella en el día", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["z2", 10], ["hiit", 8], ["z2", 0], ["z2", 10], ["z2", 10], ["long_run", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    plan.weeks[0].days[1].extraSessions = [
      { id: "mv-x", sessionType: "long_run", distanceKm: 12, origin: "moved", movedFrom: "2026-08-01", isKeySession: true },
    ];

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 1 }, { weekIndex: 0, dayIndex: 2 }, "mv-x");

    expect(res.ok).toBe(true);
    const day2 = plan.weeks[0].days[2];
    expect(day2.sessionType).toBe("long_run");
    expect(day2.isKeySession).toBe(true);
  });

  test("mover un chip con estrella no toca la estrella propia del día origen", () => {
    const week = makeWeek(1, "2026-08-03", [
      ["long_run", 16], ["z2", 8], ["z2", 10], ["z2", 10], ["z2", 10], ["z2", 16], ["z2", 6],
    ]);
    const plan = makePlan([week]);
    const fromDay = plan.weeks[0].days[0];
    fromDay.isKeySession = true; // el día tiene SU PROPIA sesión clave, independiente del chip
    fromDay.extraSessions = [
      { id: "mv-x", sessionType: "hiit", distanceKm: 5, origin: "manual", isKeySession: true },
    ];

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 0 }, { weekIndex: 0, dayIndex: 1 }, "mv-x");

    expect(res.ok).toBe(true);
    expect(fromDay.isKeySession).toBe(true); // intacto: el chip se fue, el día no perdió lo suyo
    expect(fromDay.extraSessions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// moveExtraBetweenDays — mover un chip ENTRE SEMANAS distintas (weekIndex
// 0 → 1): es el camino donde hay DOS semanas cuyos agregados hay que
// recalcular (regresión: antes solo había cobertura para índice inválido).
// ---------------------------------------------------------------------------

describe("moveExtraBetweenDays — entre semanas distintas", () => {
  test("mueve un chip de la semana 0 a la semana 1 y recalcula los agregados de AMBAS", () => {
    const week0 = makeWeek(1, "2026-08-03", [
      ["hiit", 8], ["hiit", 8], ["hiit", 8], ["hiit", 8], ["hiit", 8], ["hiit", 8], ["hiit", 8],
    ]);
    week0.days[0].extraSessions = [
      { id: "mv-x", sessionType: "z2", distanceKm: 6, origin: "moved", movedFrom: week0.days[0].date },
    ];
    const week1 = makeWeek(2, "2026-08-10", [
      ["hiit", 8], ["hiit", 8], ["rest", 0], ["hiit", 8], ["hiit", 8], ["hiit", 8], ["hiit", 8],
    ]);
    const plan = makePlan([week0, week1]);
    recalcWeekAggregates(plan.weeks[0]);
    recalcWeekAggregates(plan.weeks[1]);
    expect(plan.weeks[0].totalKm).toBe(62); // 56 (mains) + 6 (chip "moved")
    expect(plan.weeks[0].z2Km).toBe(6);
    expect(plan.weeks[1].totalKm).toBe(48);

    const res = moveExtraBetweenDays(plan, { weekIndex: 0, dayIndex: 0 }, { weekIndex: 1, dayIndex: 2 }, "mv-x");

    expect(res.ok).toBe(true);
    // Semana 0: el chip se fue, sus km ya no cuentan.
    expect(plan.weeks[0].days[0].extraSessions).toBeUndefined();
    expect(plan.weeks[0].totalKm).toBe(56);
    expect(plan.weeks[0].z2Km).toBe(0);
    // Semana 1: el día vacío (rest, índice 2) lo adopta.
    const dst = plan.weeks[1].days[2];
    expect(dst.sessionType).toBe("z2");
    expect(dst.distanceKm).toBe(6);
    expect(plan.weeks[1].totalKm).toBe(54);
    expect(plan.weeks[1].z2Km).toBe(6);
  });
});
