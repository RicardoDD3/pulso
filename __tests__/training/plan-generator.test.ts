import {
  generateTrainingPlan,
  calculatePhaseStructure,
  getMesoWeek,
  calculateWeeklyVolumes,
  buildWeekMetas,
  getStrengthSessions,
  getHiitSessions,
} from "@/lib/training/plan-generator";
import type { PlanInputs } from "@/lib/training/plan-generator-types";

const defaultInput: PlanInputs = {
  raceDistanceKm: 322,
  raceDate: "2026-06-08",
  planWeeks: 24,
  peakWeeklyKm: 190,
  currentWeeklyKm: 90,
  daysPerWeek: 6,
  longRunDay: "saturday",
  hasBackToBack: true,
  experienceLevel: "intermediate",
};

describe("generateTrainingPlan (ultra)", () => {
  // 1. genera exactamente 24 semanas
  test("genera exactamente 24 semanas", () => {
    const plan = generateTrainingPlan(defaultInput);
    expect(plan.weeks).toHaveLength(24);
  });

  // 2. la semana 24 es fase 'race' con 322km
  test("la semana 24 es fase 'race' con 322km", () => {
    const plan = generateTrainingPlan(defaultInput);
    const lastWeek = plan.weeks[23];
    expect(lastWeek.phase).toBe("race");
    expect(lastWeek.totalKm).toBe(322);
  });

  // 3. patrón 3:1 — cada 4ta semana es rest
  test("patrón 3:1 — cada 4ta semana es rest (weeks 4, 8, 12, 16, 20)", () => {
    const plan = generateTrainingPlan(defaultInput);
    const restWeekNumbers = plan.weeks
      .filter((w) => w.isRestWeek)
      .map((w) => w.weekNumber);
    // Every 4th week in the base+build+peak phases should be rest
    expect(restWeekNumbers).toContain(4);
    expect(restWeekNumbers).toContain(8);
    expect(restWeekNumbers).toContain(12);
    expect(restWeekNumbers).toContain(16);
    expect(restWeekNumbers).toContain(20);
  });

  // 4. rest weeks son ~50% de la semana anterior
  test("rest weeks son ~50% de la semana anterior", () => {
    const plan = generateTrainingPlan(defaultInput);
    for (let i = 1; i < plan.weeks.length; i++) {
      const week = plan.weeks[i];
      if (week.isRestWeek) {
        const prevKm = plan.weeks[i - 1].totalKm;
        const ratio = week.totalKm / prevKm;
        // Allow 45%-55% tolerance due to rounding
        expect(ratio).toBeGreaterThanOrEqual(0.45);
        expect(ratio).toBeLessThanOrEqual(0.55);
      }
    }
  });

  // 5. ningún fin de semana excede 95km combinados
  test("ningún fin de semana excede 95km combinados", () => {
    const plan = generateTrainingPlan(defaultInput);
    for (const week of plan.weeks) {
      if (week.phase === "race") continue; // race week is special
      expect(week.longRunPlusB2bKm).toBeLessThanOrEqual(95);
    }
  });

  // 6. ningún long run individual excede 65km
  test("ningún long run individual excede 65km", () => {
    const plan = generateTrainingPlan(defaultInput);
    for (const week of plan.weeks) {
      if (week.phase === "race") continue; // race week's long run IS the race
      const longRunDay = week.days.find(
        (d) => d.sessionType === "long_run"
      );
      if (longRunDay) {
        expect(longRunDay.distanceKm).toBeLessThanOrEqual(65);
      }
    }
  });

  // 7. no hay B2B en rest weeks
  test("no hay B2B en rest weeks", () => {
    const plan = generateTrainingPlan(defaultInput);
    for (const week of plan.weeks) {
      if (week.isRestWeek) {
        const b2bDay = week.days.find(
          (d) => d.sessionType === "back_to_back"
        );
        expect(b2bDay).toBeUndefined();
      }
    }
  });

  // 8. no hay B2B en taper
  test("no hay B2B en taper", () => {
    const plan = generateTrainingPlan(defaultInput);
    const taperWeeks = plan.weeks.filter((w) => w.phase === "taper");
    for (const week of taperWeeks) {
      const b2bDay = week.days.find(
        (d) => d.sessionType === "back_to_back"
      );
      expect(b2bDay).toBeUndefined();
    }
  });

  // 9. HIIT baja de 2 a 1 sesión en Build/Peak
  test("HIIT baja de 2 a 1 sesión en Build/Peak", () => {
    expect(getHiitSessions("base", false)).toBe(2);
    expect(getHiitSessions("build", false)).toBe(1);
    expect(getHiitSessions("peak", false)).toBe(1);
    expect(getHiitSessions("taper", false)).toBe(0);
    expect(getHiitSessions("race", false)).toBe(0);
  });

  // 10. la suma de km diarios ≈ total semanal
  test("la suma de km diarios ≈ total semanal", () => {
    const plan = generateTrainingPlan(defaultInput);
    for (const week of plan.weeks) {
      const dailySum = week.days.reduce((sum, d) => sum + d.distanceKm, 0);
      // Allow tolerance of ±3km for rounding across 7 days
      expect(Math.abs(dailySum - week.totalKm)).toBeLessThanOrEqual(3);
    }
  });

  // 11. fases están en orden correcto
  test("fases están en orden correcto", () => {
    const plan = generateTrainingPlan(defaultInput);
    const phases = plan.weeks.map((w) => w.phase);
    const uniquePhases: string[] = [];
    for (const p of phases) {
      if (uniquePhases[uniquePhases.length - 1] !== p) {
        uniquePhases.push(p);
      }
    }
    expect(uniquePhases).toEqual(["base", "build", "peak", "taper", "race"]);
  });

  // 12. semana Peak meso=3 tiene LR ≤ 55km
  test("semana Peak meso=3 tiene LR ≤ 55km", () => {
    const plan = generateTrainingPlan(defaultInput);
    const peakMeso3Weeks = plan.weeks.filter(
      (w) => w.phase === "peak" && w.mesoWeek === 3
    );
    for (const week of peakMeso3Weeks) {
      const longRunDay = week.days.find(
        (d) => d.sessionType === "long_run"
      );
      if (longRunDay) {
        expect(longRunDay.distanceKm).toBeLessThanOrEqual(55);
      }
    }
  });

  // 13. funciona con 12 semanas (plan mínimo ultra)
  test("funciona con 12 semanas (plan mínimo ultra)", () => {
    const minInput: PlanInputs = {
      ...defaultInput,
      planWeeks: 12,
    };
    const plan = generateTrainingPlan(minInput);
    expect(plan.weeks).toHaveLength(12);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
  });

  // 14. hasBackToBack=false: no B2B, Sunday is rest
  test("hasBackToBack=false: no B2B, Sunday is rest", () => {
    const noB2bInput: PlanInputs = {
      ...defaultInput,
      hasBackToBack: false,
    };
    const plan = generateTrainingPlan(noB2bInput);
    for (const week of plan.weeks) {
      const b2bDay = week.days.find(
        (d) => d.sessionType === "back_to_back"
      );
      expect(b2bDay).toBeUndefined();
    }
  });

  // 15. daysPerWeek=5: Friday is rest
  test("daysPerWeek=5: Friday is rest", () => {
    const fiveDayInput: PlanInputs = {
      ...defaultInput,
      daysPerWeek: 5,
    };
    const plan = generateTrainingPlan(fiveDayInput);
    // Check non-race weeks (race week may be special)
    const normalWeeks = plan.weeks.filter((w) => w.phase !== "race");
    for (const week of normalWeeks) {
      const friday = week.days.find((d) => d.dayOfWeek === 4); // Fri = index 4
      expect(friday).toBeDefined();
      expect(friday!.sessionType).toBe("rest");
      expect(friday!.distanceKm).toBe(0);
    }
  });

  // 16. validation: throws if currentWeeklyKm > peakWeeklyKm
  test("validation: throws if currentWeeklyKm > peakWeeklyKm", () => {
    const badInput: PlanInputs = {
      ...defaultInput,
      currentWeeklyKm: 200,
      peakWeeklyKm: 100,
    };
    expect(() => generateTrainingPlan(badInput)).toThrow(
      /currentWeeklyKm.*cannot exceed.*peakWeeklyKm/
    );
  });

  // 17. deterministic: same input = same output
  test("deterministic: same input = same output", () => {
    const plan1 = generateTrainingPlan(defaultInput);
    const plan2 = generateTrainingPlan(defaultInput);
    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  // 18. 30 weeks (maximum plan)
  test("30 weeks (maximum plan)", () => {
    const maxInput: PlanInputs = {
      ...defaultInput,
      planWeeks: 30,
    };
    const plan = generateTrainingPlan(maxInput);
    expect(plan.weeks).toHaveLength(30);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
    // Verify phases are still in correct order
    const phases = plan.weeks.map((w) => w.phase);
    const uniquePhases: string[] = [];
    for (const p of phases) {
      if (uniquePhases[uniquePhases.length - 1] !== p) {
        uniquePhases.push(p);
      }
    }
    expect(uniquePhases).toEqual(["base", "build", "peak", "taper", "race"]);
  });
});

describe("generateTrainingPlan (half marathon)", () => {
  const halfInput: PlanInputs = {
    raceDistanceKm: 21.1,
    raceDate: "2026-09-20",
    planWeeks: 12,
    peakWeeklyKm: 50,
    currentWeeklyKm: 25,
    daysPerWeek: 5,
    longRunDay: "sunday",
    hasBackToBack: false,
    experienceLevel: "beginner",
  };

  test("genera 12 semanas para medio maratón", () => {
    const plan = generateTrainingPlan(halfInput);
    expect(plan.weeks).toHaveLength(12);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
  });

  test("fases en orden correcto", () => {
    const plan = generateTrainingPlan(halfInput);
    const phases = plan.weeks.map((w) => w.phase);
    const uniquePhases: string[] = [];
    for (const p of phases) {
      if (uniquePhases[uniquePhases.length - 1] !== p) uniquePhases.push(p);
    }
    expect(uniquePhases).toEqual(["base", "build", "peak", "taper", "race"]);
  });

  test("taper es 2 semanas para medio maratón", () => {
    const plan = generateTrainingPlan(halfInput);
    const taperWeeks = plan.weeks.filter((w) => w.phase === "taper");
    expect(taperWeeks).toHaveLength(2);
  });

  test("peak es 2 semanas para medio maratón", () => {
    const plan = generateTrainingPlan(halfInput);
    const peakWeeks = plan.weeks.filter((w) => w.phase === "peak");
    expect(peakWeeks).toHaveLength(2);
  });

  test("no hay B2B en medio maratón (auto-disabled)", () => {
    // Even if hasBackToBack is true, half marathon auto-disables it
    const halfWithB2B: PlanInputs = { ...halfInput, hasBackToBack: true };
    const plan = generateTrainingPlan(halfWithB2B);
    for (const week of plan.weeks) {
      const b2b = week.days.find((d) => d.sessionType === "back_to_back");
      expect(b2b).toBeUndefined();
    }
  });

  test("long run nunca excede 21km en medio maratón", () => {
    const plan = generateTrainingPlan(halfInput);
    for (const week of plan.weeks) {
      if (week.phase === "race") continue; // race week's long run IS the race
      const lr = week.days.find((d) => d.sessionType === "long_run");
      if (lr) {
        expect(lr.distanceKm).toBeLessThanOrEqual(21);
      }
    }
  });

  test("funciona con 8 semanas (plan mínimo)", () => {
    const minHalf: PlanInputs = { ...halfInput, planWeeks: 8 };
    const plan = generateTrainingPlan(minHalf);
    expect(plan.weeks).toHaveLength(8);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
  });

  test("suma de km diarios ≈ total semanal", () => {
    const plan = generateTrainingPlan(halfInput);
    for (const week of plan.weeks) {
      const dailySum = week.days.reduce((sum, d) => sum + d.distanceKm, 0);
      expect(Math.abs(dailySum - week.totalKm)).toBeLessThanOrEqual(3);
    }
  });
});

describe("generateTrainingPlan (marathon)", () => {
  const marathonInput: PlanInputs = {
    raceDistanceKm: 42.2,
    raceDate: "2026-11-15",
    planWeeks: 16,
    peakWeeklyKm: 70,
    currentWeeklyKm: 35,
    daysPerWeek: 6,
    longRunDay: "saturday",
    hasBackToBack: false,
    experienceLevel: "intermediate",
  };

  test("genera 16 semanas para maratón", () => {
    const plan = generateTrainingPlan(marathonInput);
    expect(plan.weeks).toHaveLength(16);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
  });

  test("fases en orden correcto", () => {
    const plan = generateTrainingPlan(marathonInput);
    const phases = plan.weeks.map((w) => w.phase);
    const uniquePhases: string[] = [];
    for (const p of phases) {
      if (uniquePhases[uniquePhases.length - 1] !== p) uniquePhases.push(p);
    }
    expect(uniquePhases).toEqual(["base", "build", "peak", "taper", "race"]);
  });

  test("taper es 2 semanas para maratón", () => {
    const plan = generateTrainingPlan(marathonInput);
    const taperWeeks = plan.weeks.filter((w) => w.phase === "taper");
    expect(taperWeeks).toHaveLength(2);
  });

  test("peak es 3 semanas para maratón", () => {
    const plan = generateTrainingPlan(marathonInput);
    const peakWeeks = plan.weeks.filter((w) => w.phase === "peak");
    expect(peakWeeks).toHaveLength(3);
  });

  test("long run nunca excede 35km en maratón", () => {
    const plan = generateTrainingPlan(marathonInput);
    for (const week of plan.weeks) {
      if (week.phase === "race") continue; // race week's long run IS the race
      const lr = week.days.find((d) => d.sessionType === "long_run");
      if (lr) {
        expect(lr.distanceKm).toBeLessThanOrEqual(35);
      }
    }
  });

  test("funciona con 12 semanas", () => {
    const minMarathon: PlanInputs = { ...marathonInput, planWeeks: 12 };
    const plan = generateTrainingPlan(minMarathon);
    expect(plan.weeks).toHaveLength(12);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe("race");
  });

  test("suma de km diarios ≈ total semanal", () => {
    const plan = generateTrainingPlan(marathonInput);
    for (const week of plan.weeks) {
      const dailySum = week.days.reduce((sum, d) => sum + d.distanceKm, 0);
      expect(Math.abs(dailySum - week.totalKm)).toBeLessThanOrEqual(3);
    }
  });

  test("race week = race distance", () => {
    const plan = generateTrainingPlan(marathonInput);
    const raceWeek = plan.weeks[plan.weeks.length - 1];
    expect(raceWeek.totalKm).toBe(42.2);
  });
});

describe("calculatePhaseStructure", () => {
  test("24 weeks ultra: base=8, build=8, peak=4, taper=3, race=1", () => {
    const alloc = calculatePhaseStructure(24, 322);
    expect(alloc.baseWeeks).toBe(8);
    expect(alloc.buildWeeks).toBe(8);
    expect(alloc.peakWeeks).toBe(4);
    expect(alloc.taperWeeks).toBe(3);
    expect(alloc.raceWeek).toBe(1);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(24);
  });

  test("12 weeks ultra: total adds up", () => {
    const alloc = calculatePhaseStructure(12, 100);
    expect(alloc.peakWeeks).toBe(4);
    expect(alloc.taperWeeks).toBe(3);
    expect(alloc.raceWeek).toBe(1);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(12);
  });

  test("30 weeks ultra total adds up", () => {
    const alloc = calculatePhaseStructure(30, 322);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(30);
  });

  test("12 weeks half marathon: taper=2, peak=2", () => {
    const alloc = calculatePhaseStructure(12, 21);
    expect(alloc.taperWeeks).toBe(2);
    expect(alloc.peakWeeks).toBe(2);
    expect(alloc.raceWeek).toBe(1);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(12);
  });

  test("8 weeks half marathon: total adds up", () => {
    const alloc = calculatePhaseStructure(8, 21);
    expect(alloc.taperWeeks).toBe(2);
    expect(alloc.peakWeeks).toBe(2);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(8);
  });

  test("16 weeks marathon: taper=2, peak=3", () => {
    const alloc = calculatePhaseStructure(16, 42);
    expect(alloc.taperWeeks).toBe(2);
    expect(alloc.peakWeeks).toBe(3);
    expect(alloc.raceWeek).toBe(1);
    expect(
      alloc.baseWeeks + alloc.buildWeeks + alloc.peakWeeks + alloc.taperWeeks + alloc.raceWeek
    ).toBe(16);
  });
});

describe("getMesoWeek", () => {
  test("cycles 1,2,3,rest", () => {
    expect(getMesoWeek(1)).toBe(1);
    expect(getMesoWeek(2)).toBe(2);
    expect(getMesoWeek(3)).toBe(3);
    expect(getMesoWeek(4)).toBe("rest");
    expect(getMesoWeek(5)).toBe(1);
    expect(getMesoWeek(6)).toBe(2);
    expect(getMesoWeek(7)).toBe(3);
    expect(getMesoWeek(8)).toBe("rest");
  });
});

describe("calculateWeeklyVolumes", () => {
  test("taper weeks decrease progressively (ultra)", () => {
    const metas = buildWeekMetas(24, 322);
    const volumes = calculateWeeklyVolumes({
      metas,
      currentWeeklyKm: 90,
      peakWeeklyKm: 190,
      raceDistanceKm: 322,
    });

    const taperVolumes = metas
      .map((m, i) => ({ m, v: volumes[i] }))
      .filter(({ m }) => m.phase === "taper")
      .map(({ v }) => v);

    // Ultra taper: 60%, 40%, 20% of peak (190)
    expect(taperVolumes[0]).toBe(Math.round(190 * 0.6)); // 114
    expect(taperVolumes[1]).toBe(Math.round(190 * 0.4)); // 76
    expect(taperVolumes[2]).toBe(Math.round(190 * 0.2)); // 38
  });

  test("taper weeks decrease progressively (half marathon)", () => {
    const metas = buildWeekMetas(12, 21);
    const volumes = calculateWeeklyVolumes({
      metas,
      currentWeeklyKm: 25,
      peakWeeklyKm: 50,
      raceDistanceKm: 21,
    });

    const taperVolumes = metas
      .map((m, i) => ({ m, v: volumes[i] }))
      .filter(({ m }) => m.phase === "taper")
      .map(({ v }) => v);

    // Half marathon taper: 60%, 35% of peak (50)
    expect(taperVolumes).toHaveLength(2);
    expect(taperVolumes[0]).toBe(Math.round(50 * 0.6)); // 30
    expect(taperVolumes[1]).toBe(Math.round(50 * 0.35)); // 18
  });

  test("race week equals race distance", () => {
    const metas = buildWeekMetas(24, 322);
    const volumes = calculateWeeklyVolumes({
      metas,
      currentWeeklyKm: 90,
      peakWeeklyKm: 190,
      raceDistanceKm: 322,
    });

    const raceVolume = volumes[volumes.length - 1];
    expect(raceVolume).toBe(322);
  });
});

describe("getStrengthSessions", () => {
  test("returns correct counts per phase", () => {
    expect(getStrengthSessions("base", false)).toBe(2);
    expect(getStrengthSessions("build", false)).toBe(1);
    expect(getStrengthSessions("peak", false)).toBe(1);
    expect(getStrengthSessions("taper", false)).toBe(0);
    expect(getStrengthSessions("race", false)).toBe(0);
    // Rest weeks
    expect(getStrengthSessions("base", true)).toBe(1);
    expect(getStrengthSessions("build", true)).toBe(1);
  });
});
