import {
  computeWeekDelta,
  proposeRebalance,
  rebalanceDismissKey,
  weekTargetKm,
  type RebalanceMatch,
} from "@/lib/training/rebalance";
import { recalcWeekAggregates } from "@/lib/training/week-tracks";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
  Phase,
} from "@/lib/training/plan-generator-types";

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
    zone: sessionType === "rest" ? "" : "Z2",
    notes: "",
    isKeySession: false,
  };
}

/** Week starting Monday 2026-07-13 (same as the screenshot week). */
function makeWeek(
  sessions: [SessionType, number][],
  opts: { weekNumber?: number; phase?: Phase; startDate?: string; targetKm?: number } = {}
): GeneratedWeek {
  const start = opts.startDate ?? "2026-07-13";
  const days = sessions.map(([type, km], i) => {
    const d = new Date(start + "T12:00:00");
    d.setDate(d.getDate() + i);
    return makeDay(d.toISOString().slice(0, 10), i, type, km);
  });
  const totalKm = days.reduce((s, d) => s + d.distanceKm, 0);
  return {
    weekNumber: opts.weekNumber ?? 1,
    phase: opts.phase ?? "build",
    mesoWeek: 1,
    weekStartDate: start,
    totalKm,
    z2Km: days.filter((d) => d.sessionType === "z2").reduce((s, d) => s + d.distanceKm, 0),
    longRunPlusB2bKm: days
      .filter((d) => d.sessionType === "long_run" || d.sessionType === "back_to_back")
      .reduce((s, d) => s + d.distanceKm, 0),
    days,
    strengthSessions: sessions.filter(([t]) => t === "strength").length,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
    ...(opts.targetKm !== undefined ? { targetKm: opts.targetKm } : {}),
  } as GeneratedWeek;
}

function makePlan(weeks: GeneratedWeek[]): GeneratedPlan {
  return {
    raceDistanceKm: 100,
    raceDate: "2026-10-09",
    planWeeks: weeks.length,
    peakWeeklyKm: Math.max(...weeks.map((w) => w.totalKm)),
    currentWeeklyKm: 50,
    startDate: weeks[0].weekStartDate,
    weeks,
    nutritionGuide: { phases: [], targets: {} as never },
    strengthProgram: { exercises: [], basePhaseFrequency: "", buildPeakFrequency: "", taperFrequency: "" },
  };
}

function completed(date: string, actualKm: number): RebalanceMatch {
  return { date, status: "completed", actual_distance_km: actualKm };
}

// Standard test week: Mon z2 30 (planned), Tue z2 10, Wed z2 10 → total/target 50
// today = Tuesday 2026-07-14 (Mon is past, Tue/Wed are future/editable)
const TODAY = "2026-07-14";

// ---------------------------------------------------------------------------
// computeWeekDelta
// ---------------------------------------------------------------------------

describe("computeWeekDelta", () => {
  it("returns the deficit when a completed run came up short", () => {
    const week = makeWeek([["z2", 30], ["z2", 10], ["z2", 10]]);
    // Ran 20 of 30 on Monday → 10 km missing
    const delta = computeWeekDelta(week, [completed("2026-07-13", 20)], TODAY);
    expect(delta).toBe(10);
  });

  it("returns a negative delta (surplus) when the athlete ran extra", () => {
    const week = makeWeek([["z2", 30], ["z2", 10], ["z2", 10]]);
    const delta = computeWeekDelta(week, [completed("2026-07-13", 37)], TODAY);
    expect(delta).toBe(-7);
  });

  it("counts past days without a completed match as 0 km done", () => {
    const week = makeWeek([["z2", 10], ["z2", 10], ["z2", 10]]);
    // Monday missed entirely, no match
    const delta = computeWeekDelta(week, [], TODAY);
    expect(delta).toBe(10);
  });

  it("measures against targetKm when present, not the recalculated totalKm", () => {
    // Week was edited down: totalKm is now 40 but the original target was 50
    const week = makeWeek([["z2", 20], ["z2", 10], ["z2", 10]], { targetKm: 50 });
    const delta = computeWeekDelta(week, [completed("2026-07-13", 20)], TODAY);
    expect(delta).toBe(10);
  });

  it("los extras de días futuros suben target y proyección por igual (delta 0)", () => {
    const week = makeWeek([["z2", 30], ["z2", 10], ["z2", 10]]);
    // Martes (futuro) trae un carryover extra de 5 km
    week.days[1].extraSessions = [
      { id: "co-1", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-12" },
    ];
    const delta = computeWeekDelta(week, [completed("2026-07-13", 30)], TODAY);
    expect(delta).toBe(0);
  });

  it("cubrir el extra con km reales no cuenta como superávit", () => {
    const week = makeWeek([["z2", 30], ["z2", 10], ["z2", 10]]);
    // Lunes tenía main 30 + extra 5 y corrió 35: no sobra nada
    week.days[0].extraSessions = [
      { id: "co-1", sessionType: "z2", distanceKm: 5, origin: "carryover", carryoverFrom: "2026-07-12" },
    ];
    const delta = computeWeekDelta(week, [completed("2026-07-13", 35)], TODAY);
    expect(delta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// weekTargetKm — extras "moved" no duplican (ya están en totalKm)
// ---------------------------------------------------------------------------

describe("weekTargetKm", () => {
  it("cuenta carryover/manual/planner pero NO 'moved' (esos ya están en totalKm)", () => {
    const week = makeWeek([["z2", 8], ["z2", 8], ["z2", 8]]);
    week.days[0].extraSessions = [
      { id: "co", sessionType: "z2", distanceKm: 3, origin: "carryover", carryoverFrom: "2026-07-11" },
      { id: "m1", sessionType: "z2", distanceKm: 2, origin: "manual" },
      { id: "p1", sessionType: "hiit", distanceKm: 4, origin: "planner" },
      { id: "mv", sessionType: "hiit", distanceKm: 10, origin: "moved", movedFrom: "2026-07-12" },
    ];
    // recalcWeekAggregates es la fuente real de totalKm (igual que moveSection):
    // ya suma el extra "moved" (34 = 8+8+8 + 10), pero no los otros orígenes.
    recalcWeekAggregates(week);
    expect(week.totalKm).toBe(34);

    // weekTargetKm debe sumar solo carryover+manual+planner (3+2+4=9) encima
    // del totalKm ya correcto: si sumara también "moved" lo contaría dos veces
    // (34 ya lo trae) y devolvería 53 en vez de 43.
    expect(weekTargetKm(week)).toBe(43);
  });
});

// ---------------------------------------------------------------------------
// proposeRebalance
// ---------------------------------------------------------------------------

describe("proposeRebalance", () => {
  it("returns null when |delta| is under the 2 km threshold", () => {
    const week = makeWeek([["z2", 30], ["z2", 10], ["z2", 10]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 28.5)], TODAY);
    expect(proposal).toBeNull();
  });

  it("un déficit ya NO genera propuesta: lo cubre el carryover automático", () => {
    // Mon z2 20 (ran 14 → deficit 6) — antes proponía +4 Mar/+2 Mié
    const week = makeWeek([["z2", 20], ["z2", 20], ["z2", 10]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 14)], TODAY);
    expect(proposal).toBeNull();
  });

  it("un día perdido por completo tampoco genera propuesta de déficit", () => {
    const week = makeWeek([["z2", 20], ["z2", 20], ["z2", 10]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [], TODAY);
    expect(proposal).toBeNull();
  });

  it("reduces future days proportionally on surplus, flooring at 50%", () => {
    // Mon z2 10 → ran 30 (surplus 20); Tue/Wed z2 10 each can only drop 5 each
    const week = makeWeek([["z2", 10], ["z2", 10], ["z2", 10]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 30)], TODAY)!;

    expect(proposal.deltaKm).toBe(-20);
    expect(proposal.patches).toEqual([
      expect.objectContaining({ dayIndex: 1, oldKm: 10, newKm: 5 }),
      expect.objectContaining({ dayIndex: 2, oldKm: 10, newKm: 5 }),
    ]);
    // 20 km surplus, only 10 absorbable → 10 discarded
    expect(proposal.discardedKm).toBe(10);
  });

  it("rounds surplus patches to 0.5 km", () => {
    // Superávit 5 across Tue 13 / Wed 7 → proportional is 3.25/1.75, must round to .5
    const week = makeWeek([["z2", 30], ["z2", 13], ["z2", 7]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 35)], TODAY)!;

    for (const p of proposal.patches) {
      expect((p.newKm * 2) % 1).toBe(0);
    }
    const cut = proposal.patches.reduce((s, p) => s + (p.oldKm - p.newKm), 0);
    expect(cut + proposal.discardedKm).toBeCloseTo(5, 5);
  });

  it("returns null when there are no eligible days to rebalance", () => {
    const week = makeWeek([["z2", 30], ["strength", 0], ["rest", 0]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 40)], TODAY);
    expect(proposal).toBeNull();
  });

  it("includes a Spanish summary for surplus", () => {
    const week = makeWeek([["z2", 20], ["z2", 20], ["z2", 10]]);
    const plan = makePlan([week]);
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 26)], TODAY)!;
    expect(proposal.summary).toContain("Te pasaste 6 km");
  });

  it("correr de más cubriendo un extra planeado no dispara propuesta", () => {
    const week = makeWeek([["z2", 20], ["z2", 20], ["z2", 10]]);
    week.days[0].extraSessions = [
      { id: "m1", sessionType: "hiit", distanceKm: 6, origin: "manual" },
    ];
    const plan = makePlan([week]);
    // Corrió 26: main 20 + extra 6 → delta 0
    const proposal = proposeRebalance(plan, 0, [completed("2026-07-13", 26)], TODAY);
    expect(proposal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rebalanceDismissKey
// ---------------------------------------------------------------------------

describe("rebalanceDismissKey", () => {
  it("is stable for the same week and delta, distinct otherwise", () => {
    expect(rebalanceDismissKey(3, 10)).toBe(rebalanceDismissKey(3, 10));
    expect(rebalanceDismissKey(3, 10)).not.toBe(rebalanceDismissKey(3, 8));
    expect(rebalanceDismissKey(2, 10)).not.toBe(rebalanceDismissKey(3, 10));
  });
});
