import { resolveCurrentWeek, formatWeekAnchor, weekdayLabel } from "@/lib/training/plan-week";
import { DAY_LABELS } from "@/lib/training/plan-static-data";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
} from "@/lib/training/plan-generator-types";

/**
 * Ancla temporal del plan: sin ella, el editor de planes ("Planes") aplicaba
 * los cambios sin semana explícita a la SEMANA 1 aunque el usuario fuera en la
 * 23 — el prompt nunca decía qué día es hoy.
 */

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function makeWeek(weekNumber: number, weekStartDate: string): GeneratedWeek {
  const days: GeneratedDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(weekStartDate, i),
    dayOfWeek: i,
    dayLabel: DAY_LABELS[i],
    sessionType: "z2",
    distanceKm: 10,
    zone: "Z2",
    notes: "",
    isKeySession: false,
  }));
  return {
    weekNumber,
    phase: "build",
    mesoWeek: 1,
    weekStartDate,
    totalKm: 70,
    z2Km: 70,
    longRunPlusB2bKm: 0,
    days,
    strengthSessions: 0,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
  };
}

/** Plan de 4 semanas que arranca el lunes 2026-08-03. */
function makePlan(weekCount = 4, startDate = "2026-08-03"): GeneratedPlan {
  const weeks = Array.from({ length: weekCount }, (_, i) =>
    makeWeek(i + 1, addDays(startDate, i * 7))
  );
  return {
    raceDistanceKm: 100,
    raceDate: "2026-10-09",
    planWeeks: weekCount,
    peakWeeklyKm: 120,
    currentWeeklyKm: 60,
    startDate,
    weeks,
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: {
      exercises: [],
      basePhaseFrequency: "",
      buildPeakFrequency: "",
      taperFrequency: "",
    },
  };
}

describe("resolveCurrentWeek", () => {
  it("encuentra la semana que contiene hoy y el índice del día", () => {
    // Miércoles de la semana 2 (inicia 2026-08-10).
    const res = resolveCurrentWeek(makePlan(), "2026-08-12");
    expect(res).toEqual({
      weekNumber: 2,
      weekStartDate: "2026-08-10",
      dayIndex: 2,
      dayLabel: "Mié",
    });
  });

  it("incluye el primer día de la semana (lunes)", () => {
    const res = resolveCurrentWeek(makePlan(), "2026-08-10");
    expect(res?.weekNumber).toBe(2);
    expect(res?.dayIndex).toBe(0);
    expect(res?.dayLabel).toBe("Lun");
  });

  it("incluye el último día de la semana (domingo)", () => {
    const res = resolveCurrentWeek(makePlan(), "2026-08-16");
    expect(res?.weekNumber).toBe(2);
    expect(res?.dayIndex).toBe(6);
    expect(res?.dayLabel).toBe("Dom");
  });

  it("antes de que arranque el plan cae a la primera semana, sin día", () => {
    const res = resolveCurrentWeek(makePlan(), "2026-07-30");
    expect(res).toEqual({
      weekNumber: 1,
      weekStartDate: "2026-08-03",
      dayIndex: null,
      dayLabel: null,
    });
  });

  it("después de terminar el plan cae a la última semana, sin día", () => {
    // Plan de 4 semanas: la última termina el 2026-08-30.
    const res = resolveCurrentWeek(makePlan(), "2026-09-15");
    expect(res).toEqual({
      weekNumber: 4,
      weekStartDate: "2026-08-24",
      dayIndex: null,
      dayLabel: null,
    });
  });

  it("el último día del plan todavía cuenta como semana en curso", () => {
    const res = resolveCurrentWeek(makePlan(), "2026-08-30");
    expect(res?.weekNumber).toBe(4);
    expect(res?.dayIndex).toBe(6);
  });

  it("devuelve null si el plan no tiene semanas", () => {
    const plan = makePlan();
    plan.weeks = [];
    expect(resolveCurrentWeek(plan, "2026-08-12")).toBeNull();
  });

  it("no asume que las semanas vengan ordenadas por fecha", () => {
    const plan = makePlan();
    plan.weeks = [plan.weeks[2], plan.weeks[0], plan.weeks[3], plan.weeks[1]];
    expect(resolveCurrentWeek(plan, "2026-08-12")?.weekNumber).toBe(2);
  });

  it("usa el weekNumber real, no el índice del arreglo", () => {
    // Un plan recortado puede empezar en la semana 20.
    const plan = makePlan(2);
    plan.weeks[0].weekNumber = 20;
    plan.weeks[1].weekNumber = 21;
    expect(resolveCurrentWeek(plan, "2026-08-12")?.weekNumber).toBe(21);
  });
});

describe("formatWeekAnchor", () => {
  it("nombra el día de hoy y la semana en curso", () => {
    const anchor = formatWeekAnchor(makePlan(), "2026-08-12");
    expect(anchor).toContain("2026-08-12");
    expect(anchor).toContain("Mié");
    expect(anchor).toContain("SEMANA EN CURSO: 2");
    expect(anchor).toContain("2026-08-10");
  });

  it("avisa cuando el plan todavía no arranca", () => {
    const anchor = formatWeekAnchor(makePlan(), "2026-07-30");
    expect(anchor).toContain("2026-07-30");
    expect(anchor).toContain("SEMANA EN CURSO: 1");
    expect(anchor).toMatch(/no ha empezado|aún no/i);
  });

  it("avisa cuando el plan ya terminó", () => {
    const anchor = formatWeekAnchor(makePlan(), "2026-09-15");
    expect(anchor).toContain("SEMANA EN CURSO: 4");
    expect(anchor).toMatch(/termin/i);
  });

  it("da la fecha aunque no haya plan con semanas", () => {
    const plan = makePlan();
    plan.weeks = [];
    const anchor = formatWeekAnchor(plan, "2026-08-12");
    expect(anchor).toContain("2026-08-12");
    expect(anchor).toContain("Mié");
    expect(anchor).not.toContain("SEMANA EN CURSO");
  });

  it("siempre nombra el día de la semana, aun fuera del rango del plan", () => {
    // 2026-07-30 es jueves; el plan arranca el 2026-08-03.
    expect(formatWeekAnchor(makePlan(), "2026-07-30")).toContain("(Jue)");
  });
});

describe("weekdayLabel", () => {
  it("mapea lunes→Lun y domingo→Dom (semana que arranca en lunes)", () => {
    expect(weekdayLabel("2026-08-03")).toBe("Lun");
    expect(weekdayLabel("2026-08-05")).toBe("Mié");
    expect(weekdayLabel("2026-08-09")).toBe("Dom");
  });
});
