/**
 * Wiring de buildHealthContext (capa I/O) con TODOS los repos mockeados —
 * port de la intención de __tests__/biomarcadores/fetch-health-data.test.ts:
 * ventana única, intradía día por día, memo byte-idéntico y bloques que llegan
 * (o se omiten) en el prompt final.
 */
import type { Viewer } from "@/lib/authz/viewer";

jest.mock("@/lib/env", () => ({
  getEnv: () => ({ HEALTH_WINDOW_DAYS: 90, MAX_CONTEXT_TOKENS: 60_000 }),
}));

jest.mock("@/lib/db/repos/health", () => ({
  MAX_RANGE_DAYS: 366,
  healthDaysRange: jest.fn(),
  sleepRange: jest.fn(),
  workoutsRange: jest.fn(),
  workoutDetail: jest.fn(),
  bodyMeasurementsRange: jest.fn(),
  samplesForDay: jest.fn(),
  connectionsList: jest.fn(),
}));
jest.mock("@/lib/db/repos/exercises", () => ({
  listSets: jest.fn(),
  listLogs: jest.fn(),
  listDefinitions: jest.fn(),
}));
jest.mock("@/lib/db/repos/profiles", () => ({ getProfile: jest.fn() }));
jest.mock("@/lib/db/repos/labs", () => ({
  listSessions: jest.fn(),
  sessionResults: jest.fn(),
  flaggedHistory: jest.fn(),
}));
jest.mock("@/lib/db/repos/training", () => ({
  activePlan: jest.fn(),
  planWorkoutsForPlan: jest.fn(),
  getTrainingSettings: jest.fn(),
  listManualWorkouts: jest.fn(),
}));
jest.mock("@/lib/llm/prompt-cache", () => {
  const store = new Map<string, string>();
  return {
    PROMPT_CACHE_TTL_MS: 5 * 60 * 1000,
    promptCacheKey: (u: string, f: string, d: string) => `promptmemo:${u}|${f}|${d}`,
    getCachedPrompt: jest.fn(async (key: string) => store.get(key) ?? null),
    setCachedPrompt: jest.fn(async (key: string, prompt: string) => {
      store.set(key, prompt);
    }),
    clearPromptCache: () => store.clear(),
  };
});

import { buildHealthContext } from "@/lib/health/context";
import { daysBefore } from "@/lib/health/tz";
import {
  bodyMeasurementsRange,
  connectionsList,
  healthDaysRange,
  samplesForDay,
  sleepRange,
  workoutDetail,
  workoutsRange,
} from "@/lib/db/repos/health";
import { listDefinitions, listLogs, listSets } from "@/lib/db/repos/exercises";
import { getProfile } from "@/lib/db/repos/profiles";
import { flaggedHistory, listSessions, sessionResults } from "@/lib/db/repos/labs";
import {
  activePlan,
  getTrainingSettings,
  listManualWorkouts,
  planWorkoutsForPlan,
} from "@/lib/db/repos/training";
import { clearPromptCache } from "@/lib/llm/prompt-cache";

const viewer: Viewer = { userId: "u-1", effectiveUserId: "u-1", grant: null };

const TZ = "America/Mexico_City";
const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

const profile = {
  userId: "u-1",
  displayName: null,
  birthDate: "1992-03-10",
  sex: "M",
  maxHr: 190,
  timezone: TZ,
  locale: "es",
  unitSystem: "metric",
  primaryProvider: "garmin",
  role: "user",
};

function healthDay(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "u-1",
    date: today,
    provider: "garmin",
    steps: 15543,
    floors: 5,
    intensityMinutes: 45,
    distanceM: 12871,
    caloriesTotal: 2500,
    caloriesActive: 800,
    restingHr: 54,
    hrMin: 50,
    hrMax: 132,
    stressAvg: 30,
    stressMax: 80,
    bodyBatteryHigh: 90,
    bodyBatteryLow: 20,
    spo2Avg: 96,
    respirationAvg: 14.5,
    hrvMs: 35,
    hrvStatus: "BALANCED",
    hydrationMl: null,
    raw: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPromptCache();
  (getProfile as jest.Mock).mockResolvedValue(profile);
  (healthDaysRange as jest.Mock).mockResolvedValue([]);
  (sleepRange as jest.Mock).mockResolvedValue([]);
  (workoutsRange as jest.Mock).mockResolvedValue([]);
  (workoutDetail as jest.Mock).mockResolvedValue(null);
  (bodyMeasurementsRange as jest.Mock).mockResolvedValue([]);
  (samplesForDay as jest.Mock).mockResolvedValue([]);
  (connectionsList as jest.Mock).mockResolvedValue([]);
  (listSets as jest.Mock).mockResolvedValue([]);
  (listLogs as jest.Mock).mockResolvedValue([]);
  (listDefinitions as jest.Mock).mockResolvedValue([]);
  (listSessions as jest.Mock).mockResolvedValue([]);
  (sessionResults as jest.Mock).mockResolvedValue([]);
  (flaggedHistory as jest.Mock).mockResolvedValue([]);
  (activePlan as jest.Mock).mockResolvedValue(null);
  (planWorkoutsForPlan as jest.Mock).mockResolvedValue([]);
  (getTrainingSettings as jest.Mock).mockResolvedValue(null);
  (listManualWorkouts as jest.Mock).mockResolvedValue([]);
});

describe("buildHealthContext — ventana de datos", () => {
  it("pide HEALTH_WINDOW_DAYS a los repos de salud, sueño, workouts y ejercicios", async () => {
    await buildHealthContext(viewer, "coach");
    const from = daysBefore(today, 90);
    expect(healthDaysRange).toHaveBeenCalledWith(viewer, from, today);
    expect(sleepRange).toHaveBeenCalledWith(viewer, from, today);
    expect(workoutsRange).toHaveBeenCalledWith(viewer, from, today, { limit: 500 });
    expect(listSets).toHaveBeenCalledWith(viewer, { from, to: today });
    expect(listLogs).toHaveBeenCalledWith(viewer, { from, to: today });
  });
});

describe("buildHealthContext — intradía día por día (nunca IN(fechas))", () => {
  it("consulta Body Battery y estrés un día por llamada, 7 días cada uno", async () => {
    await buildHealthContext(viewer, "coach");
    const calls = (samplesForDay as jest.Mock).mock.calls;
    const byMetric = (m: string) => calls.filter((c) => c[2] === m);
    expect(byMetric("body_battery")).toHaveLength(7);
    expect(byMetric("stress")).toHaveLength(7);
    // Cada llamada trae UNA fecha (string), nunca una lista
    for (const c of calls) {
      expect(typeof c[1]).toBe("string");
      expect(c[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("pide la curva de FC solo de los días con carrera", async () => {
    (workoutsRange as jest.Mock).mockResolvedValue([
      {
        id: "w-run",
        userId: "u-1",
        provider: "garmin",
        externalId: "e1",
        sport: "running",
        name: "Run",
        startAt: new Date(`${today}T18:00:00Z`),
        durationS: 3000,
        distanceM: 10000,
        hrAvg: 150,
        hrMax: 180,
      },
      {
        id: "w-bike",
        userId: "u-1",
        provider: "garmin",
        externalId: "e2",
        sport: "cycling",
        name: "Bici",
        startAt: new Date(`${today}T15:00:00Z`),
        durationS: 3600,
        distanceM: 30000,
      },
    ]);
    await buildHealthContext(viewer, "coach");
    const hrCalls = (samplesForDay as jest.Mock).mock.calls.filter((c) => c[2] === "hr");
    expect(hrCalls).toHaveLength(1); // solo la fecha de la carrera, no la de la bici
    expect(hrCalls[0][1]).toBe(today);
  });

  it("el resumen intradía llega al prompt cuando hay muestras, y su anuncio también", async () => {
    const at = (hh: number) => new Date(`${today}T${String(hh).padStart(2, "0")}:00:00-06:00`);
    (samplesForDay as jest.Mock).mockImplementation(async (_v, date: string, metric: string) => {
      if (date !== today) return [];
      if (metric === "body_battery") {
        return [
          { recordedAt: at(6), value: 80, provider: "garmin" },
          { recordedAt: at(22), value: 25, provider: "garmin" },
        ];
      }
      if (metric === "stress") {
        return [
          { recordedAt: at(9), value: 40, provider: "garmin" },
          { recordedAt: at(15), value: 90, provider: "garmin" },
        ];
      }
      return [];
    });
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(prompt).toContain("BODY BATTERY Y ESTRÉS INTRADÍA");
    expect(prompt).toContain("BB 80 → 25");
    expect(prompt).toContain("estrés medio 65");
    expect(prompt).toContain("- INTRADÍA:");
  });

  it("sin muestras intradía el bloque y su anuncio se omiten (sin bloques mentirosos)", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([healthDay()]);
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(prompt).not.toContain("BODY BATTERY Y ESTRÉS INTRADÍA (últimos");
    expect(prompt).not.toContain("- INTRADÍA:");
  });
});

describe("buildHealthContext — datos canónicos al prompt", () => {
  it("manda el registro diario crudo con el mapeo old→canónico", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([healthDay()]);
    const { prompt, contextSource } = await buildHealthContext(viewer, "coach");
    expect(contextSource).toBe("fresh");
    expect(prompt).toContain("REGISTRO DIARIO COMPLETO");
    expect(prompt).toContain(`${today}: pasos 15543`);
    expect(prompt).toContain("dist 12.9 km");
    expect(prompt).toContain("FC rep 54 (mín 50, máx 132)");
    expect(prompt).toContain("HRV 35 (BALANCED)");
    expect(prompt).toContain("- DÍA A DÍA:");
  });

  it("fusiona proveedores por fecha: el primario del perfil gana campo a campo", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([
      healthDay({ id: 1, provider: "oura", steps: 111, restingHr: 60 }),
      healthDay({ id: 2, provider: "garmin", steps: 15543, restingHr: null, hrvMs: null, hrvStatus: null }),
    ]);
    const { prompt } = await buildHealthContext(viewer, "coach");
    // Una sola línea para la fecha: pasos del primario, FC rellenada por oura
    expect(prompt).toContain(`${today}: pasos 15543`);
    expect(prompt).not.toContain("pasos 111");
    expect(prompt).toContain("FC rep 60");
  });

  it("lee la meta de pasos de training_settings y cae al default sin fila", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([healthDay()]);
    (getTrainingSettings as jest.Mock).mockResolvedValue({
      userId: "u-1",
      stepsGoalMin: 220000,
      stepsGoalMax: 240000,
    });
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(prompt).toContain("PASOS (meta semanal del usuario: 220,000–240,000");

    clearPromptCache();
    (getTrainingSettings as jest.Mock).mockResolvedValue(null);
    const { prompt: fallback } = await buildHealthContext(viewer, "coach");
    expect(fallback).toContain("150,000–200,000");
  });

  it("la fuerza registrada llega con los labels del catálogo", async () => {
    (listSets as jest.Mock).mockResolvedValue([
      { date: today, exerciseKey: "press_banca", setNumber: 1, weightKg: 60, reps: 10 },
      { date: today, exerciseKey: "press_banca", setNumber: 2, weightKg: 65, reps: 6 },
    ]);
    (listLogs as jest.Mock).mockResolvedValue([{ date: today, exerciseKey: "barras", reps: 120 }]);
    (listDefinitions as jest.Mock).mockResolvedValue([
      { exerciseKey: "press_banca", label: "Press de banca", type: "weighted", weeklyGoal: null },
      { exerciseKey: "barras", label: "Barras", type: "bodyweight", weeklyGoal: 300 },
    ]);
    const { prompt } = await buildHealthContext(viewer, "tracking");
    expect(prompt).toContain("FUERZA REGISTRADA");
    expect(prompt).toContain("Press de banca 2 series");
    expect(prompt).toContain("60×10");
    expect(prompt).toContain("Barras 120 reps");
    expect(prompt).toContain("Barras 120/300");
  });

  it("labs: última sesión completa + alterados históricos en coach; NADA en tracking", async () => {
    (listSessions as jest.Mock).mockResolvedValue([
      { id: "s-2", status: "processing", sampleDate: "2026-02-01" },
      { id: "s-1", status: "completed", sampleDate: "2026-01-05" },
    ]);
    (sessionResults as jest.Mock).mockResolvedValue([
      {
        category: "Perfil Lipidico",
        testName: "Colesterol Total",
        valueNum: 259,
        valueText: null,
        unit: "mg/dL",
        refLow: 0,
        refHigh: 200,
        isFlagged: true,
      },
    ]);
    (flaggedHistory as jest.Mock).mockResolvedValue([
      {
        sampleDate: "2025-06-01",
        category: "Perfil Lipidico",
        testName: "LDL",
        valueNum: 180,
        valueText: null,
        unit: "mg/dL",
        refLow: 0,
        refHigh: 130,
      },
    ]);
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(sessionResults).toHaveBeenCalledWith(viewer, "s-1"); // la completed, no la processing
    expect(prompt).toContain("Fecha de muestra: 2026-01-05");
    expect(prompt).toContain("Colesterol Total: 259 mg/dL (ref: 0-200) ⚠️");
    expect(prompt).toContain("Alterados históricos");
    expect(prompt).toContain("LDL: 180 mg/dL (ref: 0-130)");

    (listSessions as jest.Mock).mockClear();
    const { prompt: tracking } = await buildHealthContext(viewer, "tracking");
    expect(listSessions).not.toHaveBeenCalled();
    expect(tracking).not.toContain("Colesterol Total");
  });

  it("perfil + ancla temporal: edad, tz, proveedores y HOY en la tz del usuario", async () => {
    (connectionsList as jest.Mock).mockResolvedValue([
      { provider: "garmin", status: "active" },
      { provider: "oura", status: "active" },
    ]);
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(prompt).toContain("=== PERFIL Y ANCLA TEMPORAL ===");
    expect(prompt).toContain("Zona horaria: America/Mexico_City | Proveedores conectados: garmin, oura");
    expect(prompt).toContain(`HOY: ${today} (`);
    expect(prompt).toContain("Sexo: M | FC máx: 190");
  });

  it("instruye el idioma desde profile.locale", async () => {
    (getProfile as jest.Mock).mockResolvedValue({ ...profile, locale: "en" });
    const { prompt } = await buildHealthContext(viewer, "coach");
    expect(prompt).toContain("Responde en el idioma del usuario: en.");
  });
});

describe("buildHealthContext — memo y determinismo", () => {
  it("la segunda llamada sirve el MISMO string desde el memo, sin volver a los repos", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([healthDay()]);
    const first = await buildHealthContext(viewer, "coach");
    expect(first.contextSource).toBe("fresh");
    const queriesAfterFirst = (healthDaysRange as jest.Mock).mock.calls.length;

    const second = await buildHealthContext(viewer, "coach");
    expect(second.contextSource).toBe("memo");
    expect(second.prompt).toBe(first.prompt); // idéntico, no solo equivalente
    expect((healthDaysRange as jest.Mock).mock.calls.length).toBe(queriesAfterFirst);
  });

  it("el memo no cruza features: cada kind construye su propio prompt", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([healthDay()]);
    const coach = await buildHealthContext(viewer, "coach");
    const tracking = await buildHealthContext(viewer, "tracking");
    expect(tracking.contextSource).toBe("fresh");
    expect(tracking.prompt).not.toBe(coach.prompt);
  });

  it("reconstruir con los mismos datos produce un prompt byte-idéntico (regla c)", async () => {
    (healthDaysRange as jest.Mock).mockResolvedValue([
      healthDay({ date: daysBefore(today, 1) }),
      healthDay(),
    ]);
    const first = await buildHealthContext(viewer, "coach");
    clearPromptCache(); // fuerza la reconstrucción completa
    const second = await buildHealthContext(viewer, "coach");
    expect(second.contextSource).toBe("fresh");
    expect(second.prompt).toBe(first.prompt);
  });
});
