/**
 * Los chats veían Garmin solo agregado (promedios 7/30/90, percentiles,
 * tendencia semanal): no podían responder "¿cuántos pasos di el martes?" ni
 * "¿cuánto sueño profundo llevo esta semana?" porque el día a día nunca llegaba
 * al prompt, y varias columnas con dato (distancia diaria, FC mín/máx,
 * hrv_status, fases de sueño, horario de sueño) no salían en ningún lado.
 *
 * Estos bloques mandan el registro crudo día por día y los pasos contra la meta
 * semanal del usuario (training_settings).
 */
import { formatDailyLog, formatStepsBlock } from "@/lib/health/daily-log";

const DAY = {
  date: "2026-08-04",
  steps: 15543,
  distance_meters: 12871,
  total_calories: 1745,
  active_calories: 278,
  resting_hr: 54,
  min_hr: 50,
  max_hr: 132,
  avg_stress: 27,
  body_battery_high: 76,
  body_battery_low: 37,
  avg_respiration: 13,
  hrv_weekly_avg: 35,
  hrv_status: "BALANCED",
  floors_climbed: 27.432,
  floors_descended: 13.277,
  moderate_intensity_min: 2,
  vigorous_intensity_min: 2,
};

const NIGHT = {
  date: "2026-08-04",
  sleep_seconds: 19920,
  deep_sleep_seconds: 2280,
  light_sleep_seconds: 14040,
  rem_sleep_seconds: 3600,
  awake_seconds: 1860,
  sleep_score: 67,
  sleep_start: "2026-08-04T07:12:20+00:00",
  sleep_end: "2026-08-04T13:15:20+00:00",
};

describe("formatDailyLog", () => {
  it("emite una línea por día con todas las métricas del resumen diario", () => {
    const text = formatDailyLog([DAY], []);
    const line = text.split("\n").find((l) => l.includes("2026-08-04"))!;

    expect(line).toContain("pasos 15543");
    expect(line).toContain("dist 12.9 km");
    expect(line).toContain("cal 1745 (act 278)");
    expect(line).toContain("FC rep 54 (mín 50, máx 132)");
    expect(line).toContain("estrés 27");
    expect(line).toContain("BB 76→37");
    expect(line).toContain("resp 13");
    expect(line).toContain("HRV 35 (BALANCED)");
    expect(line).toContain("pisos 27↑/13↓");
    expect(line).toContain("intensidad 4 min (mod 2 + vig 2)");
  });

  it("agrega el sueño del día con fases, score y horario en hora de CDMX", () => {
    const line = formatDailyLog([DAY], [NIGHT])
      .split("\n")
      .find((l) => l.includes("2026-08-04"))!;

    expect(line).toContain("sueño 5.5 h");
    expect(line).toContain("score 67");
    expect(line).toContain("prof 38m");
    expect(line).toContain("ligero 234m");
    expect(line).toContain("REM 60m");
    expect(line).toContain("desp 31m");
    // 07:12 UTC = 01:12 en CDMX (UTC-6)
    expect(line).toContain("01:12→07:15");
  });

  it("omite las métricas sin dato en vez de imprimir null", () => {
    const line = formatDailyLog(
      [{ date: "2026-08-03", steps: 8000, avg_spo2: null, hydration_ml: null, resting_hr: null }],
      []
    )
      .split("\n")
      .find((l) => l.includes("2026-08-03"))!;

    expect(line).toContain("pasos 8000");
    expect(line).not.toContain("null");
    expect(line).not.toContain("FC rep");
  });

  it("ordena los días de más viejo a más reciente y los lista todos", () => {
    const text = formatDailyLog(
      [
        { date: "2026-08-04", steps: 3 },
        { date: "2026-08-02", steps: 1 },
        { date: "2026-08-03", steps: 2 },
      ],
      []
    );
    const dates = text.match(/2026-08-0\d/g);

    expect(dates).toEqual(["2026-08-02", "2026-08-03", "2026-08-04"]);
  });

  it("incluye una noche de sueño aunque ese día no tenga resumen diario", () => {
    const text = formatDailyLog([DAY], [NIGHT, { date: "2026-08-05", sleep_seconds: 21600, sleep_score: 80 }]);

    expect(text).toContain("2026-08-05");
    expect(text).toContain("sueño 6.0 h");
  });

  it("devuelve cadena vacía cuando no hay nada que registrar", () => {
    expect(formatDailyLog([], [])).toBe("");
  });
});

describe("formatStepsBlock", () => {
  // 3 semanas completas de 10k pasos diarios + parte de la semana en curso
  const days = [
    { date: "2026-07-27", steps: 10000 },
    { date: "2026-07-28", steps: 20000 },
    { date: "2026-07-29", steps: 30000 },
    { date: "2026-08-03", steps: 40000 },
    { date: "2026-08-04", steps: 15543 },
  ];

  it("declara la meta semanal del usuario y la meta diaria derivada", () => {
    const text = formatStepsBlock(days, { min: 150000, max: 200000 }, "2026-08-04");

    expect(text).toContain("150,000");
    expect(text).toContain("200,000");
    expect(text).toContain("21,429"); // 150000 / 7
  });

  it("suma cada semana (lunes) y la compara contra la meta mínima", () => {
    const text = formatStepsBlock(days, { min: 150000, max: 200000 }, "2026-08-04");
    const week = text.split("\n").find((l) => l.includes("2026-07-27"))!;

    expect(week).toContain("60.0k"); // 10k + 20k + 30k
    expect(week).toContain("40%"); // 60000 / 150000
  });

  it("marca la semana en curso como parcial (no se lee como semana fallada)", () => {
    const text = formatStepsBlock(days, { min: 150000, max: 200000 }, "2026-08-04");
    const week = text.split("\n").find((l) => l.includes("2026-08-03"))!;

    expect(week).toContain("en curso");
  });

  it("cuenta los días que alcanzaron la meta diaria", () => {
    const text = formatStepsBlock(days, { min: 70000, max: 70000 }, "2026-08-04");

    // meta diaria = 10,000 → 5 de 5 días la alcanzan
    expect(text).toContain("5/5");
  });

  it("devuelve cadena vacía si no hay ningún día con pasos", () => {
    expect(formatStepsBlock([], { min: 150000, max: 200000 }, "2026-08-04")).toBe("");
    expect(
      formatStepsBlock([{ date: "2026-08-04", steps: null }], { min: 1, max: 1 }, "2026-08-04")
    ).toBe("");
  });
});
