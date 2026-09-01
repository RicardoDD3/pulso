import {
  isModificationRequest,
  instructionRequestsRest,
  parseRestWeekdays,
  enforceWeekdayRest,
  applyPlanPatches,
  buildModifyPrompt,
} from "@/lib/training/plan-modifier";
import { removeRestDays } from "@/lib/training/week-tracks";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
} from "@/lib/training/plan-generator-types";

/**
 * Regression: isModificationRequest must not classify a read-only question as a
 * plan-modification command because a short verb happens to be a *substring* of
 * an unrelated word.
 *
 * Bug (found 2026-07-20 bug hunt): the verb check used
 * `MODIFICATION_VERBS.some((v) => normalized.includes(v))`, so "pon" ⊂
 * "responder" and "baja" ⊂ "trabajar" made benign questions route through the
 * plan-modify path in the coach chat.
 */
describe("isModificationRequest — substring false positives (regression)", () => {
  it("does not treat 'pon' inside 'responder' as a modification verb", () => {
    expect(
      isModificationRequest("¿Puedes responder qué día es mejor para el long run?")
    ).toBe(false);
  });

  it("does not treat 'baja' inside 'trabajar' as a modification verb", () => {
    expect(
      isModificationRequest("Esta semana tengo que trabajar mucho, ¿afecta mi plan?")
    ).toBe(false);
  });

  it("still detects genuine whole-word modification requests", () => {
    expect(isModificationRequest("mueve el long run del sábado al domingo")).toBe(true);
    expect(isModificationRequest("baja los km de la semana 3")).toBe(true);
    expect(isModificationRequest("agrega una sesión de fuerza el martes")).toBe(true);
    expect(isModificationRequest("cambia el z2 del lunes a hiit")).toBe(true);
  });

  it("requires both a verb and a training noun", () => {
    // verb but no training noun
    expect(isModificationRequest("mueve la reunión a las 5")).toBe(false);
    // training noun but no verb
    expect(isModificationRequest("¿cuántos km llevo esta semana?")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Descansos pedidos por el usuario (regression 2026-07-20)
//
// Bug: "los domingos son días de descanso" en el chat "Planes" no se
// respetaba. El LLM sí parcheaba el domingo a "rest", pero el route de
// /modify llamaba removeRestDays() sin distinguir descansos pedidos por el
// usuario, y los revertía a Z2. Fix: instructionRequestsRest() detecta la
// petición explícita y applyPlanPatches marca esos días con restLocked, que
// removeRestDays respeta.
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function makeDay(dayOfWeek: number, sessionType: SessionType, distanceKm: number): GeneratedDay {
  return {
    date: `2026-07-${String(20 + dayOfWeek).padStart(2, "0")}`,
    dayOfWeek,
    dayLabel: DAY_LABELS[dayOfWeek],
    sessionType,
    distanceKm,
    zone: sessionType === "rest" ? "" : "Z2",
    notes: "",
    isKeySession: false,
  };
}

function makeWeek(weekNumber: number, sessions: [SessionType, number][]): GeneratedWeek {
  const days = sessions.map(([type, km], i) => makeDay(i, type, km));
  return {
    weekNumber,
    phase: "build",
    mesoWeek: 1,
    weekStartDate: days[0].date,
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
    peakWeeklyKm: 120,
    currentWeeklyKm: 60,
    startDate: weeks[0].weekStartDate,
    weeks,
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: { exercises: [], basePhaseFrequency: "", buildPeakFrequency: "", taperFrequency: "" },
  };
}

const FULL_WEEK: [SessionType, number][] = [
  ["z2", 15], ["hiit", 12], ["z2", 15], ["z2", 19], ["z2", 15], ["long_run", 38], ["back_to_back", 19],
];

describe("instructionRequestsRest", () => {
  it("detects explicit rest-day requests in Spanish", () => {
    expect(instructionRequestsRest("los domingos son días de descanso")).toBe(true);
    expect(instructionRequestsRest("quiero descansar los domingos")).toBe(true);
    expect(instructionRequestsRest("pon el domingo como descanso")).toBe(true);
  });

  it("detects 'rest' as a whole word", () => {
    expect(instructionRequestsRest("pon rest el domingo")).toBe(true);
  });

  it("ignores instructions that do not ask for rest", () => {
    expect(instructionRequestsRest("sube 10 km la semana 3")).toBe(false);
    expect(instructionRequestsRest("mueve el long run al sábado")).toBe(false);
    // "resta" (restar km) no es "rest"
    expect(instructionRequestsRest("resta 5 km al long run del sábado")).toBe(false);
  });
});

describe("applyPlanPatches — user-requested rest days", () => {
  const sundayRestPatches = (weeks: number[]) =>
    JSON.stringify(weeks.map((w) => ({ week: w, day: 6, sessionType: "rest", distanceKm: 0 })));

  it("marks patched rest days as restLocked when lockRestDays is on", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK), makeWeek(2, FULL_WEEK)]);
    const result = applyPlanPatches(sundayRestPatches([1, 2]), plan, { lockRestDays: true });

    expect(result.plan).not.toBeNull();
    for (const week of result.plan!.weeks) {
      const sunday = week.days[6];
      expect(sunday.sessionType).toBe("rest");
      expect(sunday.distanceKm).toBe(0);
      expect(sunday.restLocked).toBe(true);
    }
  });

  it("does not mark restLocked without the option (LLM-proposed rest)", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    const result = applyPlanPatches(sundayRestPatches([1]), plan);

    expect(result.plan).not.toBeNull();
    expect(result.plan!.weeks[0].days[6].restLocked).toBeUndefined();
  });

  it("clears restLocked when the user turns a locked rest day back into a run", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.weeks[0].days[6].sessionType = "rest";
    plan.weeks[0].days[6].distanceKm = 0;
    plan.weeks[0].days[6].restLocked = true;

    const patches = JSON.stringify([{ week: 1, day: 6, sessionType: "z2", distanceKm: 10 }]);
    const result = applyPlanPatches(patches, plan, { lockRestDays: false });

    expect(result.plan).not.toBeNull();
    const sunday = result.plan!.weeks[0].days[6];
    expect(sunday.sessionType).toBe("z2");
    expect(sunday.restLocked).toBeUndefined();
  });

  it("applies strengthDay patches and recalculates strengthSessions", () => {
    // "agrega fuerza el viernes y quítala del lunes" — la fuerza es un flag
    // por día, editable desde el chat sin tocar la corrida.
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.weeks[0].days[0].strengthDay = true;
    plan.weeks[0].strengthSessions = 1;

    const patches = JSON.stringify([
      { week: 1, day: 4, strengthDay: true },
      { week: 1, day: 0, strengthDay: false },
    ]);
    const result = applyPlanPatches(patches, plan);

    expect(result.plan).not.toBeNull();
    const week = result.plan!.weeks[0];
    expect(week.days[4].strengthDay).toBe(true);
    expect(week.days[0].strengthDay).toBe(false);
    // la corrida del viernes no cambió
    expect(week.days[4].sessionType).toBe("z2");
    expect(week.days[4].distanceKm).toBe(15);
    expect(week.strengthSessions).toBe(1);
  });

  it("keeps Sundays as rest after the modify pipeline (patches + removeRestDays)", () => {
    // Reproduce el pipeline completo del route /modify:
    // applyPlanPatches(..., {lockRestDays}) → removeRestDays()
    const plan = makePlan([makeWeek(1, FULL_WEEK), makeWeek(2, FULL_WEEK)]);
    const instruction = "los domingos son días de descanso";

    const result = applyPlanPatches(sundayRestPatches([1, 2]), plan, {
      lockRestDays: instructionRequestsRest(instruction),
    });
    expect(result.plan).not.toBeNull();
    removeRestDays(result.plan!);

    for (const week of result.plan!.weeks) {
      expect(week.days[6].sessionType).toBe("rest");
      expect(week.days[6].distanceKm).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// applyPlanPatches — extraSessions (cuadritos extra desde el chat Planes)
// ---------------------------------------------------------------------------

describe("applyPlanPatches — extraSessions", () => {
  it("agrega una sesión extra a un día vía patch en lenguaje natural", () => {
    // "agrégame el martes una sesión extra de 5 km de HIIT"
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    const patches = JSON.stringify([
      {
        week: 1,
        day: 1,
        extraSessions: [{ sessionType: "hiit", distanceKm: 5, origin: "planner" }],
      },
    ]);
    const result = applyPlanPatches(patches, plan);

    expect(result.plan).not.toBeNull();
    const tuesday = result.plan!.weeks[0].days[1];
    expect(tuesday.extraSessions).toHaveLength(1);
    expect(tuesday.extraSessions![0].sessionType).toBe("hiit");
    expect(tuesday.extraSessions![0].origin).toBe("planner");
    // La sesión principal del día no cambió
    expect(tuesday.distanceKm).toBe(plan.weeks[0].days[1].distanceKm);
  });

  it("quitar un carryover vía patch registra el descarte", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.weeks[0].days[1].extraSessions = [
      {
        id: "co-x-z2",
        sessionType: "z2",
        distanceKm: 5,
        origin: "carryover",
        carryoverFrom: "2026-07-06",
      },
    ];
    const patches = JSON.stringify([{ week: 1, day: 1, extraSessions: [] }]);
    const result = applyPlanPatches(patches, plan);

    expect(result.plan).not.toBeNull();
    const tuesday = result.plan!.weeks[0].days[1];
    expect(tuesday.extraSessions).toBeUndefined();
    expect(tuesday.carryoverDismissed).toEqual(["2026-07-06:z2"]);
  });

  it("un extra inválido del LLM regresa error sin tocar el plan", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    const patches = JSON.stringify([
      { week: 1, day: 1, extraSessions: [{ sessionType: "yoga", distanceKm: 5 }] },
    ]);
    const result = applyPlanPatches(patches, plan);
    expect(result.plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRestWeekdays + enforceWeekdayRest (regression 2026-07-20, 2ª ronda)
//
// Bug: "los domingos son días de descanso" dejó intactas las semanas cuyo
// domingo tenía long run/B2B (el LLM usó la excepción de "sesión clave" de la
// regla 6 y las saltó — S21 siguió con B2B 19 km el domingo). El route ahora
// garantiza determinísticamente el descanso recurrente: enforceWeekdayRest
// fuerza rest+restLocked en ese día de TODAS las semanas (excepto semanas de
// carrera y el día de la carrera) redistribuyendo los km a los Z2 de la misma
// semana.
// ---------------------------------------------------------------------------

describe("parseRestWeekdays", () => {
  it("detecta el día pedido en el mensaje real del usuario", () => {
    expect(
      parseRestWeekdays(
        "incorpora un ejercicio de sentadilla búlgara y los domingos son días de descanso redistribuye este semana el plan"
      )
    ).toEqual([6]);
  });

  it("detecta varios días", () => {
    expect(parseRestWeekdays("quiero descansar los sábados y domingos")).toEqual([5, 6]);
  });

  it("sin petición de descanso no devuelve días aunque se nombren", () => {
    expect(parseRestWeekdays("mueve el long run del sábado al domingo")).toEqual([]);
  });

  it("sin día nombrado devuelve vacío aunque pida descanso", () => {
    expect(parseRestWeekdays("quiero descansar más")).toEqual([]);
  });
});

describe("enforceWeekdayRest", () => {
  it("fuerza rest+restLocked en el día aunque tenga B2B y redistribuye los km a los Z2", () => {
    // Semana como la S21 del usuario: Dom = back_to_back 19 km.
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    const before = plan.weeks[0].days.reduce((s, d) => s + d.distanceKm, 0);

    const changed = enforceWeekdayRest(plan, [6]);

    expect(changed).toBe(true);
    const week = plan.weeks[0];
    const sunday = week.days[6];
    expect(sunday.sessionType).toBe("rest");
    expect(sunday.restLocked).toBe(true);
    expect(sunday.distanceKm).toBe(0);
    // los 19 km se redistribuyen a los días z2 (lun/mié/jue/vie)
    const after = week.days.reduce((s, d) => s + d.distanceKm, 0);
    expect(Math.round(after * 10) / 10).toBe(before);
    expect(week.totalKm).toBe(before);
    // long run del sábado y hiit del martes intactos
    expect(week.days[5].distanceKm).toBe(38);
    expect(week.days[1].distanceKm).toBe(12);
    // los z2 crecieron
    expect(week.days[0].distanceKm).toBeGreaterThan(15);
  });

  it("sobrevive a removeRestDays (queda bloqueado)", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    enforceWeekdayRest(plan, [6]);
    removeRestDays(plan);
    expect(plan.weeks[0].days[6].sessionType).toBe("rest");
    expect(plan.weeks[0].days[6].distanceKm).toBe(0);
  });

  it("bloquea también un domingo que ya era rest (parcheado por el LLM) y es idempotente", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.weeks[0].days[6].sessionType = "rest";
    plan.weeks[0].days[6].distanceKm = 0;

    expect(enforceWeekdayRest(plan, [6])).toBe(true);
    expect(plan.weeks[0].days[6].restLocked).toBe(true);
    // segunda pasada: nada que cambiar
    expect(enforceWeekdayRest(plan, [6])).toBe(false);
  });

  it("no toca semanas de carrera", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.weeks[0].phase = "race";
    expect(enforceWeekdayRest(plan, [6])).toBe(false);
    expect(plan.weeks[0].days[6].sessionType).toBe("back_to_back");
  });

  it("no toca el día de la carrera (raceDate)", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK)]);
    plan.raceDate = plan.weeks[0].days[6].date;
    expect(enforceWeekdayRest(plan, [6])).toBe(false);
    expect(plan.weeks[0].days[6].sessionType).toBe("back_to_back");
  });

  it("pipeline completo del route: parches tímidos del LLM + enforcement → TODOS los domingos descansan", () => {
    // El LLM solo parchea el domingo z2 de la semana 1 y salta la semana 2
    // (domingo B2B), como hizo Gemini. El enforcement cubre la semana saltada.
    const Z2_SUNDAY_WEEK: [SessionType, number][] = [
      ["z2", 15], ["hiit", 12], ["z2", 15], ["z2", 19], ["z2", 15], ["long_run", 38], ["z2", 11],
    ];
    const plan = makePlan([makeWeek(1, Z2_SUNDAY_WEEK), makeWeek(2, FULL_WEEK)]);
    const instruction =
      "los domingos son días de descanso redistribuye este semana el plan";

    const llmPatches = JSON.stringify([{ week: 1, day: 6, sessionType: "rest", distanceKm: 0 }]);
    const result = applyPlanPatches(llmPatches, plan, {
      lockRestDays: instructionRequestsRest(instruction),
    });
    expect(result.plan).not.toBeNull();
    enforceWeekdayRest(result.plan!, parseRestWeekdays(instruction));
    removeRestDays(result.plan!);

    for (const week of result.plan!.weeks) {
      expect(week.days[6].sessionType).toBe("rest");
      expect(week.days[6].distanceKm).toBe(0);
      expect(week.days[6].restLocked).toBe(true);
    }
    // la semana 2 conservó su volumen total (los 19 km del B2B se movieron a z2)
    expect(result.plan!.weeks[1].totalKm).toBe(133);
  });
});

// ---------------------------------------------------------------------------
// Ancla temporal: "si no digo semana, es ESTA semana" (2026-08-04)
//
// El prompt de /modify nunca decía qué día es hoy, así que un cambio sin
// semana explícita ("cambia el miércoles a 10 km") aterrizaba en la semana 1
// aunque el usuario fuera en la 23. Y enforceWeekdayRest reescribía TODAS las
// semanas, incluidas las que ya pasaron.
// ---------------------------------------------------------------------------

/** Semana con fechas reales a partir de un lunes (makeWeek reusa el mismo día). */
function datedWeek(weekNumber: number, startDate: string): GeneratedWeek {
  const week = makeWeek(weekNumber, FULL_WEEK);
  week.weekStartDate = startDate;
  week.days.forEach((day, i) => {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    day.date = d.toISOString().split("T")[0];
  });
  return week;
}

describe("enforceWeekdayRest — alcance desde la semana en curso", () => {
  it("no toca las semanas anteriores a fromWeek", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK), makeWeek(2, FULL_WEEK), makeWeek(3, FULL_WEEK)]);

    enforceWeekdayRest(plan, [6], 3);

    // Semanas 1 y 2 ya pasaron: se quedan como estaban.
    expect(plan.weeks[0].days[6].sessionType).toBe("back_to_back");
    expect(plan.weeks[0].days[6].distanceKm).toBe(19);
    expect(plan.weeks[1].days[6].sessionType).toBe("back_to_back");
    // Semana 3 (en curso) sí descansa.
    expect(plan.weeks[2].days[6].sessionType).toBe("rest");
    expect(plan.weeks[2].days[6].restLocked).toBe(true);
  });

  it("aplica a la semana en curso y a todas las siguientes", () => {
    const plan = makePlan([makeWeek(21, FULL_WEEK), makeWeek(22, FULL_WEEK), makeWeek(23, FULL_WEEK)]);

    expect(enforceWeekdayRest(plan, [6], 22)).toBe(true);

    expect(plan.weeks[0].days[6].sessionType).toBe("back_to_back");
    expect(plan.weeks[1].days[6].sessionType).toBe("rest");
    expect(plan.weeks[2].days[6].sessionType).toBe("rest");
  });

  it("devuelve false si todas las semanas quedaron fuera de alcance", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK), makeWeek(2, FULL_WEEK)]);
    expect(enforceWeekdayRest(plan, [6], 5)).toBe(false);
    expect(plan.weeks[0].days[6].sessionType).toBe("back_to_back");
  });

  it("sin fromWeek conserva el comportamiento de siempre (todas las semanas)", () => {
    const plan = makePlan([makeWeek(1, FULL_WEEK), makeWeek(2, FULL_WEEK)]);
    expect(enforceWeekdayRest(plan, [6])).toBe(true);
    expect(plan.weeks[0].days[6].sessionType).toBe("rest");
    expect(plan.weeks[1].days[6].sessionType).toBe("rest");
  });
});

describe("buildModifyPrompt — ancla de semana en curso", () => {
  const plan = () =>
    makePlan([
      datedWeek(21, "2026-07-20"),
      datedWeek(22, "2026-07-27"),
      datedWeek(23, "2026-08-03"),
    ]);

  it("inyecta la fecha de hoy y la semana en curso", () => {
    const { systemPrompt } = buildModifyPrompt(plan(), "cambia el miércoles a 10 km", "2026-08-05");
    expect(systemPrompt).toContain("2026-08-05");
    expect(systemPrompt).toContain("SEMANA EN CURSO: 23");
  });

  it("instruye aplicar a la semana en curso cuando no se nombra semana", () => {
    const { systemPrompt } = buildModifyPrompt(plan(), "cambia el miércoles a 10 km", "2026-08-05");
    expect(systemPrompt).toMatch(/semana en curso/i);
    expect(systemPrompt).toMatch(/no menciona|no nombra|no especifica/i);
  });

  it("acota lo recurrente a la semana en curso en adelante, no al pasado", () => {
    const { systemPrompt } = buildModifyPrompt(plan(), "los domingos son descanso", "2026-08-05");
    expect(systemPrompt).toMatch(/en adelante|hacia adelante|siguientes/i);
    expect(systemPrompt).toMatch(/nunca.*(anterior|pasad)/i);
  });

  it("marca la semana en curso y el día de hoy en el plan compacto", () => {
    const { userMessage } = buildModifyPrompt(plan(), "sube 5 km", "2026-08-05");
    const compact = JSON.parse(userMessage.slice(userMessage.indexOf("["), userMessage.lastIndexOf("]") + 1));
    const current = compact.find((w: { current?: boolean }) => w.current);
    expect(current.weekNumber).toBe(23);
    // 2026-08-05 es miércoles → índice 2 de la semana que inicia el lunes 03.
    expect(current.days[2].today).toBe(true);
    expect(current.days[0].today).toBeUndefined();
    // Las semanas pasadas no se marcan.
    expect(compact.filter((w: { current?: boolean }) => w.current)).toHaveLength(1);
  });

  it("sigue funcionando sin fecha (no inventa ancla)", () => {
    const { systemPrompt, userMessage } = buildModifyPrompt(plan(), "sube 5 km");
    expect(systemPrompt).not.toContain("SEMANA EN CURSO");
    expect(userMessage).toContain("weekNumber");
  });
});

describe("buildModifyPrompt — la fuerza del plan es visible para el LLM", () => {
  it("expone strengthDay como 'fz' en el plan compacto", () => {
    const plan = makePlan([datedWeek(1, "2026-08-03")]);
    plan.weeks[0].days[3].strengthDay = true;

    const { userMessage } = buildModifyPrompt(plan, "quítame la fuerza del jueves", "2026-08-05");
    const compact = JSON.parse(userMessage.slice(userMessage.indexOf("["), userMessage.lastIndexOf("]") + 1));

    expect(compact[0].days[3].fz).toBe(true);
    // Los días sin fuerza no cargan la llave (ruido de tokens en 32 semanas).
    expect(compact[0].days[0].fz).toBeUndefined();
  });

  it("expone los descansos bloqueados por el usuario", () => {
    const plan = makePlan([datedWeek(1, "2026-08-03")]);
    plan.weeks[0].days[6].sessionType = "rest";
    plan.weeks[0].days[6].distanceKm = 0;
    plan.weeks[0].days[6].restLocked = true;

    const { userMessage } = buildModifyPrompt(plan, "sube 5 km", "2026-08-05");
    const compact = JSON.parse(userMessage.slice(userMessage.indexOf("["), userMessage.lastIndexOf("]") + 1));

    expect(compact[0].days[6].rest).toBe(true);
  });
});
