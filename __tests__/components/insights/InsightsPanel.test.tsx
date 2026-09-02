/**
 * InsightsPanel (contenedor de insights portados): sincroniza + carga el plan
 * y la salud desde las rutas de Pulso, adapta las filas camelCase y compone
 * los paneles (Hoy, Race Readiness, Progreso). En readOnly no dispara sync.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import InsightsPanel from "@/components/training/insights/InsightsPanel";

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

/* ------------------------------------------------------------------ */
/* Fixtures — fechas ancladas a "hoy" según getTodayISO (CDMX)         */
/* ------------------------------------------------------------------ */

const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

function isoOffset(days: number): string {
  const d = new Date(todayISO + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function makeWeek(weekNumber: number, startOffset: number) {
  return {
    weekNumber,
    phase: "base",
    mesoWeek: 1,
    weekStartDate: isoOffset(startOffset),
    totalKm: 40,
    z2Km: 25,
    longRunPlusB2bKm: 15,
    strengthSessions: 2,
    nutritionNote: "",
    specificityNote: "",
    isRestWeek: false,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: isoOffset(startOffset + i),
      dayOfWeek: i,
      dayLabel: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][i],
      sessionType: i === 6 ? "rest" : "z2",
      distanceKm: i === 6 ? 0 : 8,
      zone: "Z2 (128-142 bpm)",
      notes: "",
      isKeySession: i === 5,
    })),
  };
}

const generatedPlan = {
  raceDistanceKm: 50,
  raceDate: isoOffset(20),
  planWeeks: 2,
  peakWeeklyKm: 60,
  currentWeeklyKm: 40,
  startDate: isoOffset(-3),
  weeks: [makeWeek(1, -3), makeWeek(2, 4)],
  nutritionGuide: { phases: [], targets: {} },
  strengthProgram: { weeklySessions: 2, exercises: [] },
};

const planRow = {
  id: "plan-1",
  name: "UTMB 50K",
  goalType: "ultra",
  goalDate: isoOffset(20),
  goalTime: null,
  goalDistanceKm: 50,
  status: "active",
  llmUsed: null,
  terrain: "trail",
  planJson: generatedPlan,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const workoutRows = generatedPlan.weeks.flatMap((w) =>
  w.days
    .filter((d) => d.sessionType !== "rest")
    .map((d, i) => ({
      id: `w-${w.weekNumber}-${i}`,
      planId: "plan-1",
      weekNumber: w.weekNumber,
      dayOfWeek: d.dayOfWeek,
      date: d.date,
      workoutType: "easy_run",
      title: "Z2",
      targetDistanceKm: d.distanceKm,
      targetPaceRange: null,
      targetHrZone: null,
      matchedWorkoutId: null,
      matchedManualId: null,
      status: d.date < todayISO ? "completed" : "planned",
      actualDistanceKm: d.date < todayISO ? 8.1 : null,
      actualPace: null,
    }))
);

const healthDay = {
  date: todayISO,
  steps: 9000,
  restingHr: 48,
  stressAvg: 25,
  bodyBatteryHigh: 80,
  bodyBatteryLow: 30,
  spo2Avg: 97,
  respirationAvg: 14,
  hrvMs: 65,
  caloriesTotal: 2000,
  hydrationMl: null,
  floors: 5,
  intensityMinutes: 40,
};

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (url.includes("/sync")) return json({ ok: true });
    if (url === "/api/training/plans/plan-1")
      return json({ plan: planRow, workouts: workoutRows });
    if (url.startsWith("/api/health/daily"))
      return json({
        day: healthDay,
        sleep: [{ endAt: `${todayISO}T07:00:00Z`, totalMin: 420, score: 82, isNap: false }],
      });
    if (url.startsWith("/api/health/trends")) return json({ daily: [healthDay], sleep: [] });
    if (url.startsWith("/api/health/workouts"))
      return json({
        workouts: [
          {
            id: "11111111-2222-3333-4444-555555555555",
            provider: "garmin",
            sport: "trail_running",
            name: "Morning Run",
            startAt: `${isoOffset(-1)}T08:00:00Z`,
            durationS: 3600,
            distanceM: 8100,
            hrAvg: 140,
            hrMax: 160,
            vo2max: 52,
            speedAvgMps: 2.25,
          },
        ],
      });
    if (url.includes("matched-activities")) return json({ matches: [] });
    return json({});
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

test("carga plan + salud, compone los paneles y dispara el auto-sync", async () => {
  render(<InsightsPanel planId="plan-1" />);

  await waitFor(() => expect(screen.getByText("Race Readiness")).toBeInTheDocument());

  // TodayWorkoutCard: hoy es día z2 de 8 km.
  expect(screen.getByText("TODAY")).toBeInTheDocument();
  expect(screen.getByText("8 km")).toBeInTheDocument();

  // Anillos de progreso + countdown.
  expect(screen.getByText("Progress")).toBeInTheDocument();
  expect(screen.getByText("20 days")).toBeInTheDocument();

  const urls = fetchMock.mock.calls.map(([u]) => String(u));
  expect(urls).toContain("/api/training/plans/plan-1/sync");
  expect(urls).toContain("/api/training/plans/plan-1/matched-activities");
  expect(urls.some((u) => u.startsWith("/api/health/trends?days=90"))).toBe(true);
});

test("readOnly no dispara el auto-sync", async () => {
  render(<InsightsPanel planId="plan-1" readOnly />);

  await waitFor(() => expect(screen.getByText("Race Readiness")).toBeInTheDocument());

  const urls = fetchMock.mock.calls.map(([u]) => String(u));
  expect(urls.some((u) => u.includes("/sync"))).toBe(false);
});
