/**
 * The deterministic plan-creation path (POST /plans, generator:"deterministic")
 * must produce a complete, valid plan WITHOUT any LLM configured — pure
 * generator → default strength days → normalization → unpack.
 */
import { generateTrainingPlan } from "@/lib/training/plan-generator";
import { applyDefaultStrengthDays, DEFAULT_STRENGTH_DOWS } from "@/lib/training/week-tracks";
import {
  normalizePlanJson,
  planWorkoutSeedsFromGeneratedPlan,
} from "@/lib/db/repos/training";
import type { PlanInputs } from "@/lib/training/plan-generator-types";

const inputs: PlanInputs = {
  raceDistanceKm: 100,
  raceDate: "2027-03-06",
  planWeeks: 24,
  peakWeeklyKm: 120,
  currentWeeklyKm: 50,
  daysPerWeek: 6,
  longRunDay: "saturday",
  hasBackToBack: true,
  experienceLevel: "intermediate",
};

describe("deterministic generation path (no LLM)", () => {
  it("builds a full GeneratedPlan and unpacks non-empty plan workout rows", () => {
    const plan = generateTrainingPlan(inputs);
    applyDefaultStrengthDays(plan);
    normalizePlanJson(plan); // same call the repo write path makes

    expect(plan.weeks).toHaveLength(24);
    for (const week of plan.weeks) {
      expect(week.days).toHaveLength(7);
      expect(week.totalKm).toBeGreaterThan(0);
    }
    // Default strength days Mon/Wed/Fri on every week.
    for (const week of plan.weeks) {
      for (const dow of DEFAULT_STRENGTH_DOWS) {
        expect(week.days[dow].strengthDay).toBe(true);
      }
    }

    const seeds = planWorkoutSeedsFromGeneratedPlan(plan);
    expect(seeds.length).toBeGreaterThan(24 * 5);
    // Every seed row is insertable: has a week, a date and a workout type.
    for (const seed of seeds) {
      expect(seed.weekNumber).toBeGreaterThanOrEqual(1);
      expect(seed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(seed.workoutType).toBeTruthy();
    }
    // Strength flags produced their own rows.
    expect(seeds.some((s) => s.workoutType === "strength")).toBe(true);
  });

  it("rejects invalid inputs with an error (route maps it to 400)", () => {
    expect(() => generateTrainingPlan({ ...inputs, raceDistanceKm: 5 })).toThrow();
  });
});
