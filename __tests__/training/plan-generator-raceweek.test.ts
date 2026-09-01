import { generateTrainingPlan } from "@/lib/training/plan-generator";
import type { PlanInputs } from "@/lib/training/plan-generator-types";

/**
 * Regression: race week must put the race on the race day and NOT spread the
 * race distance across weekday Z2 runs.
 *
 * Bug (found 2026-07-20 bug hunt): distributeDailyKm() relied on relabeling a
 * "long_run" day that never exists on the race week (calculateLongRunKm returns
 * 0 for phase "race"), so the whole race distance leaked onto Mon–Fri as 20 km
 * Z2 runs and no day was ever marked "DÍA DE CARRERA".
 */
const raceInput: PlanInputs = {
  raceDistanceKm: 100,
  raceDate: "2026-06-12",
  planWeeks: 24,
  peakWeeklyKm: 120,
  currentWeeklyKm: 50,
  daysPerWeek: 6,
  longRunDay: "saturday",
  hasBackToBack: true,
  experienceLevel: "advanced",
};

describe("generateTrainingPlan — race week distribution (regression)", () => {
  const plan = generateTrainingPlan(raceInput);
  const raceWeek = plan.weeks[plan.weeks.length - 1];

  it("the last week is the race week", () => {
    expect(raceWeek.phase).toBe("race");
    expect(raceWeek.totalKm).toBe(raceInput.raceDistanceKm);
  });

  it("marks exactly one day as the race day", () => {
    const raceDays = raceWeek.days.filter((d) => d.notes === "DÍA DE CARRERA");
    expect(raceDays).toHaveLength(1);
  });

  it("the race day carries the full race distance as a long run", () => {
    const raceDay = raceWeek.days.find((d) => d.notes === "DÍA DE CARRERA");
    expect(raceDay).toBeDefined();
    expect(raceDay!.sessionType).toBe("long_run");
    expect(raceDay!.distanceKm).toBe(raceInput.raceDistanceKm);
    expect(raceDay!.isKeySession).toBe(true);
  });

  it("does NOT spread the race distance across weekday Z2 runs", () => {
    const z2Km = raceWeek.days
      .filter((d) => d.sessionType === "z2")
      .reduce((s, d) => s + d.distanceKm, 0);
    // Weekday runs must be light shakeouts, never the full race distance.
    expect(z2Km).toBeLessThan(raceInput.raceDistanceKm);
  });

  it("keeps the week total consistent with the sum of day distances", () => {
    const sum = raceWeek.days.reduce((s, d) => s + d.distanceKm, 0);
    expect(Math.round(sum * 10) / 10).toBe(raceWeek.totalKm);
  });
});
