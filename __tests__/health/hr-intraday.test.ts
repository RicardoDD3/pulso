import {
  findElevatedWindow,
  approxMinutesAbove,
  formatHrCurveDay,
  ELEVATED_HR_THRESHOLD,
} from "@/lib/health/hr-intraday";

/**
 * 2026-07-21: el coach negaba tener acceso a los picos dentro de una carrera.
 * Las heart_rate_samples (monitoreo diario, ~1 muestra c/2 min) sí dibujan la
 * ventana del entrenamiento: este módulo la encuentra y la formatea para el
 * prompt (hora CDMX, máx muestreado, minutos sobre umbrales, curva completa).
 */

const BASE = Date.parse("2026-07-21T13:00:00Z"); // 07:00 en CDMX (UTC-6)
const at = (min: number, hr: number) => ({ timestamp_ms: BASE + min * 60_000, heart_rate: hr });

describe("findElevatedWindow", () => {
  it("encuentra el bloque contiguo más largo de FC elevada", () => {
    const samples = [
      at(0, 80),
      at(2, 85),
      at(6, 121),
      at(8, 125),
      at(10, 130),
      at(12, 128),
      at(14, 90),
      // segundo bloque elevado, más corto y lejos (>8 min de hueco)
      at(30, 130),
      at(32, 132),
    ];
    const w = findElevatedWindow(samples)!;
    expect(w.startMs).toBe(BASE + 6 * 60_000);
    expect(w.endMs).toBe(BASE + 12 * 60_000);
    expect(w.maxHr).toBe(130);
    expect(w.samples).toHaveLength(4);
  });

  it("tolera huecos cortos (≤8 min) dentro del bloque", () => {
    const samples = [at(0, 120), at(6, 125), at(12, 130)];
    const w = findElevatedWindow(samples)!;
    expect(w.samples).toHaveLength(3);
    expect(w.endMs).toBe(BASE + 12 * 60_000);
  });

  it("devuelve null cuando ninguna muestra supera el umbral", () => {
    expect(findElevatedWindow([at(0, 90), at(2, 100)])).toBeNull();
    expect(findElevatedWindow([])).toBeNull();
  });

  it("el umbral por defecto es 110 bpm", () => {
    expect(ELEVATED_HR_THRESHOLD).toBe(110);
  });
});

describe("approxMinutesAbove", () => {
  it("cada muestra cuenta su gap al siguiente; la última cuenta 2 min", () => {
    // [130,150,150,150,90] cada 2 min → ≥140: muestras en t=2,4,6 → 2+2+2 = 6
    const samples = [at(0, 130), at(2, 150), at(4, 150), at(6, 150), at(8, 90)];
    expect(approxMinutesAbove(samples, 140)).toBe(6);
  });

  it("capea gaps largos a 4 min para no inflar la permanencia", () => {
    // gap de 10 min entre muestras → cuenta 4; la última cuenta 2 → 6
    const samples = [at(0, 150), at(10, 150)];
    expect(approxMinutesAbove(samples, 140)).toBe(6);
  });

  it("devuelve 0 si ninguna muestra alcanza el umbral", () => {
    expect(approxMinutesAbove([at(0, 120)], 140)).toBe(0);
  });
});

describe("formatHrCurveDay", () => {
  const daySamples = [
    at(0, 95),
    at(2, 120),
    at(4, 140),
    at(6, 150),
    at(8, 165),
    at(10, 150),
    at(12, 120),
    at(14, 95),
  ];

  it("formatea ventana en hora CDMX, máx muestreado, minutos sobre cortes y la curva", () => {
    const out = formatHrCurveDay("2026-07-21", daySamples, { easyMaxBpm: 145, qualityMinBpm: 161 })!;
    expect(out).toContain(
      "2026-07-21 | ventana elevada 07:02–07:12 | máx muestra 165 (07:08) | ~12 min ≥110 bpm | ~6 min >145 bpm | ~2 min ≥161 bpm"
    );
    expect(out).toContain(
      "curva: 07:02 120 · 07:04 140 · 07:06 150 · 07:08 165 · 07:10 150 · 07:12 120"
    );
  });

  it("omite los cortes cuando no hay referencia de zonas", () => {
    const out = formatHrCurveDay("2026-07-21", daySamples, null)!;
    expect(out).toContain("~12 min ≥110 bpm");
    expect(out).not.toContain(">145");
    expect(out).not.toContain("≥161");
  });

  it("devuelve null cuando el día no tiene ventana elevada", () => {
    expect(formatHrCurveDay("2026-07-21", [at(0, 90)], null)).toBeNull();
    expect(formatHrCurveDay("2026-07-21", [], null)).toBeNull();
  });
});
