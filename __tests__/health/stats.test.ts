import {
  percentile,
  computeStats,
  computeStatsWithDates,
  formatStatsLine,
  formatMinSec,
} from "@/lib/health/stats";

/**
 * 2026-07-21: los chats (Coach, Training, Planes) y la generación de planes
 * solo veían promedios de Garmin. Este módulo es la fuente única de
 * estadísticas completas (media, percentiles, picos con fecha, σ, n) sobre
 * los últimos 90 días. Todo determinístico y verificable a mano.
 */

describe("percentile", () => {
  const sorted = [10, 20, 30, 40];

  it("interpola linealmente con el método (n-1)*p", () => {
    expect(percentile(sorted, 0.5)).toBe(25); // idx 1.5 → 20 + 0.5*10
    expect(percentile(sorted, 0.25)).toBe(17.5); // idx 0.75
    expect(percentile(sorted, 0.75)).toBe(32.5); // idx 2.25
  });

  it("p=0 devuelve el mínimo y p=1 el máximo", () => {
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 1)).toBe(40);
  });

  it("con un solo valor todos los percentiles colapsan a ese valor", () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });
});

describe("computeStats", () => {
  it("devuelve null con array vacío o solo nulls", () => {
    expect(computeStats([])).toBeNull();
    expect(computeStats([null, null])).toBeNull();
  });

  it("ignora nulls y calcula sobre los valores presentes", () => {
    const s = computeStats([null, 2, null, 4]);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(2);
    expect(s!.mean).toBe(3);
    expect(s!.min).toBe(2);
    expect(s!.max).toBe(4);
  });

  it("con n=1: percentiles y extremos colapsan al valor y σ=0", () => {
    const s = computeStats([5])!;
    expect(s.n).toBe(1);
    expect(s.mean).toBe(5);
    expect(s.std).toBe(0);
    expect(s.min).toBe(5);
    expect(s.max).toBe(5);
    expect(s.p10).toBe(5);
    expect(s.p25).toBe(5);
    expect(s.p50).toBe(5);
    expect(s.p75).toBe(5);
    expect(s.p90).toBe(5);
  });

  it("dataset conocido [2,4,6,8] (entra desordenado): percentiles y σ poblacional", () => {
    const s = computeStats([8, 2, 6, 4])!;
    expect(s.n).toBe(4);
    expect(s.mean).toBe(5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(8);
    expect(s.p50).toBe(5);
    expect(s.p25).toBe(3.5);
    expect(s.p75).toBe(6.5);
    expect(s.p10).toBeCloseTo(2.6);
    expect(s.p90).toBeCloseTo(7.4);
    // σ poblacional: varianza (9+1+1+9)/4 = 5 → √5
    expect(s.std).toBeCloseTo(Math.sqrt(5));
  });

  it("incluye ceros (0 es un valor válido, no un null)", () => {
    const s = computeStats([0, 10])!;
    expect(s.n).toBe(2);
    expect(s.mean).toBe(5);
    expect(s.min).toBe(0);
  });
});

describe("computeStatsWithDates", () => {
  const rows = [
    { date: "2026-01-01", v: 8 },
    { date: "2026-01-02", v: 2 },
    { date: "2026-01-03", v: 6 },
    { date: "2026-01-04", v: null },
  ];
  const get = (r: { v: number | null }) => r.v;
  const getDate = (r: { date: string }) => r.date;

  it("devuelve las fechas del mínimo y del pico", () => {
    const s = computeStatsWithDates(rows, get, getDate)!;
    expect(s.n).toBe(3);
    expect(s.min).toBe(2);
    expect(s.minDate).toBe("2026-01-02");
    expect(s.max).toBe(8);
    expect(s.maxDate).toBe("2026-01-01");
  });

  it("ante empate en el extremo gana la fecha más reciente", () => {
    const tied = [
      { date: "2026-01-01", v: 5 },
      { date: "2026-01-02", v: 5 },
    ];
    const s = computeStatsWithDates(tied, get, getDate)!;
    expect(s.minDate).toBe("2026-01-02");
    expect(s.maxDate).toBe("2026-01-02");
  });

  it("devuelve null si ninguna fila tiene valor", () => {
    expect(computeStatsWithDates([{ date: "2026-01-01", v: null }], get, getDate)).toBeNull();
  });
});

describe("formatMinSec", () => {
  it("formatea minutos decimales como m:ss", () => {
    expect(formatMinSec(5)).toBe("5:00");
    expect(formatMinSec(5.5)).toBe("5:30");
  });

  it("acarrea los segundos: 5.9983 min → 6:00, nunca 5:60", () => {
    expect(formatMinSec(5.9983)).toBe("6:00");
  });
});

describe("formatStatsLine", () => {
  const stats = computeStats([8, 2, 6, 4])!;

  it("renderiza la línea canónica completa con decimales", () => {
    expect(formatStatsLine(stats, { decimals: 1 })).toBe(
      "media 5.0 | p50 5.0 | p25–p75 3.5–6.5 | p10–p90 2.6–7.4 | mín 2.0 | máx 8.0 | σ 2.2 | n 4"
    );
  });

  it("agrega la unidad a cada valor", () => {
    const s = computeStats([7.5])!;
    expect(formatStatsLine(s, { decimals: 1, unit: "h" })).toBe(
      "media 7.5h | p50 7.5h | p25–p75 7.5h–7.5h | p10–p90 7.5h–7.5h | mín 7.5h | máx 7.5h | σ 0.0h | n 1"
    );
  });

  it("incluye las fechas de los picos cuando vienen de computeStatsWithDates", () => {
    const s = computeStatsWithDates(
      [
        { date: "2026-01-02", v: 2 },
        { date: "2026-01-01", v: 8 },
      ],
      (r) => r.v,
      (r) => r.date
    )!;
    const line = formatStatsLine(s, { decimals: 0 });
    expect(line).toContain("mín 2 (2026-01-02)");
    expect(line).toContain("máx 8 (2026-01-01)");
  });

  it("omite el paréntesis de fecha cuando la fila no traía fecha", () => {
    const s = computeStatsWithDates(
      [{ date: undefined as unknown as string, v: 5 }],
      (r) => r.v,
      (r) => String(r.date || "")
    )!;
    const line = formatStatsLine(s, { decimals: 0 });
    expect(line).toContain("mín 5 | máx 5");
    expect(line).not.toContain("(");
  });

  it("acepta formateador y etiquetas custom (ritmo: mejor/peor)", () => {
    const s = computeStats([5, 6])!;
    const line = formatStatsLine(s, {
      fmt: formatMinSec,
      minLabel: "mejor",
      maxLabel: "peor",
    });
    expect(line).toContain("media 5:30");
    expect(line).toContain("mejor 5:00");
    expect(line).toContain("peor 6:00");
  });
});
