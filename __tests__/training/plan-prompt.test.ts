import { formatRunningProfile, formatRecoveryProfile } from "@/lib/training/plan-prompt";

/**
 * Regression: formatRunningProfile builds a text profile fed to the LLM plan
 * generator. Two number-formatting bugs (found 2026-07-20 bug hunt):
 *
 *  1. When every qualifying run has no positive duration, `paces` is empty and
 *     Math.min(...[])/Math.max(...[]) produce Infinity/-Infinity, rendering
 *     "Rango de ritmo: Infinity:NaN - -Infinity:NaN".
 *  2. formatPace rounded seconds independently, so a pace of 5.9983 min/km
 *     rendered "5:60" instead of carrying over to "6:00".
 */
describe("formatRunningProfile — pace formatting (regression)", () => {
  it("never emits Infinity/NaN when runs have no valid duration", () => {
    const out = formatRunningProfile([
      { activity_type: "running", distance_meters: 5000, duration_seconds: 0 },
    ]);
    expect(out).not.toContain("Infinity");
    expect(out).not.toContain("NaN");
    // The pace line should simply be omitted, like the guarded FC/VO2 lines.
    expect(out).not.toContain("Rango de ritmo");
    // But the rest of the profile is still present.
    expect(out).toContain("Carreras ultimos 90 dias: 1");
  });

  it("carries seconds over instead of printing ':60'", () => {
    const out = formatRunningProfile([
      { activity_type: "running", distance_meters: 10000, duration_seconds: 3599 },
    ]);
    expect(out).not.toContain(":60");
    expect(out).toContain("6:00");
  });

  it("formats a normal pace correctly", () => {
    // 3000s / 10000m = 5:00 min/km exactly
    const out = formatRunningProfile([
      { activity_type: "running", distance_meters: 10000, duration_seconds: 3000 },
    ]);
    expect(out).toContain("5:00");
  });
});

/**
 * 2026-07-21: la generación de planes recibía solo promedios y extremos. El
 * prompt del atleta ahora incluye distribuciones completas (percentiles, picos
 * con fecha, σ) de distancias, ritmos, volumen semanal y recuperación.
 */
describe("formatRunningProfile — distribuciones completas", () => {
  const runs = [
    { date: "2026-07-10", activity_type: "running", distance_meters: 4000, duration_seconds: 1440 },
    { date: "2026-07-08", activity_type: "running", distance_meters: 10000, duration_seconds: 2700 },
    { date: "2026-07-03", activity_type: "running", distance_meters: 20000, duration_seconds: 7200 },
    { date: "2026-07-01", activity_type: "running", distance_meters: 10000, duration_seconds: 3000 },
  ];

  it("incluye la distribución de distancias con percentiles y picos con fecha", () => {
    const out = formatRunningProfile(runs);
    expect(out).toContain(
      "Distribución de distancia (km): media 11.0 | p50 10.0 | p25–p75 8.5–12.5 | p10–p90 5.8–17.0 | mín 4.0 (2026-07-10) | máx 20.0 (2026-07-03) | σ 5.7 | n 4"
    );
  });

  it("incluye la distribución de ritmos con mejor/peor con fecha", () => {
    const out = formatRunningProfile(runs);
    expect(out).toContain("Distribución de ritmo (min/km): media 5:23 | p50 5:30");
    expect(out).toContain("mejor 4:30 (2026-07-08)");
    expect(out).toContain("peor 6:00 (2026-07-10)");
  });

  it("incluye la distribución del volumen semanal", () => {
    const out = formatRunningProfile(runs);
    // Semana del 2026-06-29: 30 km | semana del 2026-07-06: 14 km
    expect(out).toContain("Distribución volumen semanal (km): media 22.0 | p50 22.0");
    expect(out).toContain("máx 30.0 (semana del 2026-06-29)");
  });

  it("omite la distribución de ritmo cuando no hay duraciones válidas", () => {
    const out = formatRunningProfile([
      { date: "2026-07-10", activity_type: "running", distance_meters: 5000, duration_seconds: 0 },
    ]);
    expect(out).not.toContain("Distribución de ritmo");
    expect(out).toContain("Distribución de distancia (km):");
  });
});

describe("formatRunningProfile — distribución de intensidad (HIIT/tempo/Z2)", () => {
  it("reporta conteos por intensidad y el split fácil/calidad", () => {
    const runs = [
      // HIIT: spread 35, pico = máx personal
      { date: "2026-07-10", activity_type: "running", distance_meters: 8000, duration_seconds: 2400, avg_hr: 150, max_hr: 185 },
      // Z2: 135/185 = 73% del máx personal
      { date: "2026-07-08", activity_type: "running", distance_meters: 10000, duration_seconds: 3600, avg_hr: 135, max_hr: 148 },
      { date: "2026-07-06", activity_type: "running", distance_meters: 10000, duration_seconds: 3600, avg_hr: 135, max_hr: 148 },
      { date: "2026-07-04", activity_type: "running", distance_meters: 10000, duration_seconds: 3600, avg_hr: 135, max_hr: 148 },
      // sin FC
      { date: "2026-07-02", activity_type: "running", distance_meters: 5000, duration_seconds: 1500 },
    ];
    const out = formatRunningProfile(runs);
    expect(out).toContain(
      "Distribución de intensidad (por FC): Z2 3 (75%) | HIIT 1 (25%) | sin FC 1 — fácil/calidad: 75/25"
    );
  });

  it("omite la línea cuando ninguna carrera tiene FC", () => {
    const out = formatRunningProfile([
      { date: "2026-07-02", activity_type: "running", distance_meters: 5000, duration_seconds: 1500 },
    ]);
    expect(out).not.toContain("Distribución de intensidad");
  });
});

describe("formatRecoveryProfile — estadísticas completas", () => {
  const summaries = [
    { date: "2026-07-19", resting_hr: 50, hrv_weekly_avg: 60, avg_stress: 30, body_battery_high: 80 },
    { date: "2026-07-20", resting_hr: 46, hrv_weekly_avg: 70, avg_stress: 40, body_battery_high: 90 },
  ];
  const sleep = [
    { date: "2026-07-19", sleep_seconds: 25200, sleep_score: 80 }, // 7h
    { date: "2026-07-20", sleep_seconds: 28800, sleep_score: 90 }, // 8h
  ];

  it("cada métrica de recuperación lleva la línea completa de estadísticas con picos y fecha", () => {
    const out = formatRecoveryProfile(summaries, sleep);
    expect(out).toContain("FC Reposo (bpm): media 48 | p50 48");
    expect(out).toContain("mín 46 (2026-07-20) | máx 50 (2026-07-19)");
    expect(out).toContain("HRV (ms): media 65 | p50 65");
    expect(out).toContain("Estrés (0-100): media 35 | p50 35");
    expect(out).toContain("Body Battery máx: media 85 | p50 85");
    expect(out).toContain("Sueño (h): media 7.5h | p50 7.5h");
    expect(out).toContain("Sueño score: media 85 | p50 85");
  });

  it("mantiene el fallback cuando no hay datos", () => {
    expect(formatRecoveryProfile([], [])).toBe("Sin datos de recuperacion.");
  });
});
