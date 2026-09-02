/**
 * ComplianceChart (insights portados): agrega km reales y % de cumplimiento
 * por semana desde las filas del plan y señala la semana actual. recharts se
 * mockea (jsdom no tiene layout, ResponsiveContainer no renderiza).
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import ComplianceChart from "@/components/training/insights/ComplianceChart";
import type { PlanWeek, TrainingPlanWorkout } from "@/lib/training/types";

jest.mock("next-intl", () => {
  const en = jest.requireActual("@/messages/en.json");
  const resolve = (namespace: string, key: string, values?: Record<string, unknown>): string => {
    let cur: unknown = en;
    for (const part of `${namespace}.${key}`.split(".")) {
      cur = (cur as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof cur !== "string") throw new Error(`missing i18n key: ${namespace}.${key}`);
    return cur.replace(/\{(\w+)\}/g, (m, k) => (values && k in values ? String(values[k]) : m));
  };
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      resolve(namespace, key, values),
    useLocale: () => "en",
  };
});

jest.mock("recharts", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const nullComp = () => null;
  return {
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    ComposedChart: passthrough,
    Bar: nullComp,
    Area: nullComp,
    Line: nullComp,
    XAxis: nullComp,
    YAxis: nullComp,
    CartesianGrid: nullComp,
    Tooltip: nullComp,
    Legend: nullComp,
    ReferenceLine: nullComp,
  };
});

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function workout(over: Partial<TrainingPlanWorkout>): TrainingPlanWorkout {
  return {
    id: 1,
    plan_id: 1,
    week_number: 1,
    day_of_week: 0,
    date: isoOffset(0),
    workout_type: "easy_run",
    title: "Easy",
    target_distance_km: 8,
    target_pace_range: null,
    target_hr_zone: null,
    matched_activity_id: null,
    matched_workout_id: null,
    status: "planned",
    actual_distance_km: null,
    actual_pace: null,
    created_at: "",
    ...over,
  };
}

// Semana 1 contiene hoy (de -3 a +3): 2 de 3 sesiones no-rest completadas.
const planWorkouts: TrainingPlanWorkout[] = [
  workout({ id: 1, date: isoOffset(-3), status: "completed", actual_distance_km: 8.2 }),
  workout({ id: 2, date: isoOffset(-1), status: "completed", actual_distance_km: 11.9 }),
  workout({ id: 3, date: isoOffset(1), workout_type: "long_run" }),
  workout({ id: 4, date: isoOffset(2), workout_type: "rest", target_distance_km: null }),
];

const weeks: PlanWeek[] = [
  {
    week_number: 1,
    phase: "base",
    target_km: 30,
    notes: "",
    workouts: planWorkouts.map((w) => ({
      day_of_week: w.day_of_week,
      date: w.date,
      workout_type: w.workout_type,
      title: w.title,
      description: "",
      target_distance_km: w.target_distance_km,
      target_duration_min: null,
      target_pace_range: null,
      target_hr_zone: null,
      intervals_detail: null,
      strength_exercises: null,
    })),
  },
];

test("agrega km reales y cumplimiento de la semana actual", () => {
  render(<ComplianceChart planWorkouts={planWorkouts} weeks={weeks} />);

  expect(screen.getByText("Weekly Mileage")).toBeInTheDocument();
  // 8.2 + 11.9 = 20.1 km reales; 2/3 sesiones no-rest completadas → 67%.
  expect(
    screen.getByText("Current week: 20.1 / 30 km (67% compliance)")
  ).toBeInTheDocument();
});

test("sin semana actual (plan futuro) no pinta el resumen", () => {
  const future = weeks.map((w) => ({
    ...w,
    workouts: w.workouts.map((pw, i) => ({ ...pw, date: isoOffset(10 + i) })),
  }));
  render(<ComplianceChart planWorkouts={[]} weeks={future} />);
  expect(screen.queryByText(/compliance/)).toBeNull();
});
