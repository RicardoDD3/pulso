import { toWeightPoint, buildWeightHistory, formatBodyComposition } from "@/lib/health/weight";

describe("toWeightPoint", () => {
  it("converts weight_grams to kg", () => {
    expect(toWeightPoint({ date: "2026-07-15", weight_grams: 78450 })).toEqual({
      date: "2026-07-15",
      weightKg: 78.45,
    });
  });

  it("returns null for null row or missing weight", () => {
    expect(toWeightPoint(null)).toBeNull();
    expect(toWeightPoint({ date: "2026-07-15", weight_grams: null })).toBeNull();
    expect(toWeightPoint({ date: "2026-07-15" })).toBeNull();
  });

  it("coerces string weight_grams (Supabase numeric) to number", () => {
    expect(toWeightPoint({ date: "2026-07-15", weight_grams: "80100" as unknown as number })).toEqual({
      date: "2026-07-15",
      weightKg: 80.1,
    });
  });
});

describe("buildWeightHistory", () => {
  it("maps rows to kg points sorted ascending by date", () => {
    const rows = [
      { date: "2026-03-22", weight_grams: 79800 },
      { date: "2026-03-16", weight_grams: 79600 },
      { date: "2026-03-19", weight_grams: 79900 },
    ];
    expect(buildWeightHistory(rows)).toEqual([
      { date: "2026-03-16", weightKg: 79.6 },
      { date: "2026-03-19", weightKg: 79.9 },
      { date: "2026-03-22", weightKg: 79.8 },
    ]);
  });

  it("drops rows without a weight and tolerates null/empty input", () => {
    const rows = [
      { date: "2026-03-22", weight_grams: 79800 },
      { date: "2026-03-23", weight_grams: null },
      { date: "2026-03-24" },
    ];
    expect(buildWeightHistory(rows)).toEqual([{ date: "2026-03-22", weightKg: 79.8 }]);
    expect(buildWeightHistory([])).toEqual([]);
    expect(buildWeightHistory(null)).toEqual([]);
    expect(buildWeightHistory(undefined)).toEqual([]);
  });

  it("keeps a single measurement", () => {
    expect(buildWeightHistory([{ date: "2026-03-23", weight_grams: 56500 }])).toEqual([
      { date: "2026-03-23", weightKg: 56.5 },
    ]);
  });
});

/**
 * De body_composition solo el PESO llegaba a los prompts (buildWeightHistory).
 * Grasa corporal, músculo, agua, hueso e IMC existen en la tabla y los chats
 * nunca los veían: "no tengo tu % de grasa" con el dato en la DB.
 */
describe("formatBodyComposition", () => {
  const rows = [
    {
      date: "2026-03-22",
      weight_grams: 79819,
      bmi: 24.1,
      body_fat_pct: 18.4,
      muscle_mass_grams: 62000,
      body_water_pct: 55.2,
      bone_mass_grams: 3200,
    },
    { date: "2026-04-15", weight_grams: 78500, bmi: 23.7 },
  ];

  it("lista cada medición con todas sus columnas con dato", () => {
    const text = formatBodyComposition(rows);
    const first = text.split("\n").find((l) => l.includes("2026-03-22"))!;

    expect(first).toContain("79.8 kg");
    expect(first).toContain("IMC 24.1");
    expect(first).toContain("grasa 18.4%");
    expect(first).toContain("músculo 62.0 kg");
    expect(first).toContain("agua 55.2%");
    expect(first).toContain("hueso 3.2 kg");
  });

  it("omite las columnas sin dato de una medición parcial", () => {
    const second = formatBodyComposition(rows).split("\n").find((l) => l.includes("2026-04-15"))!;

    expect(second).toContain("78.5 kg");
    expect(second).toContain("IMC 23.7");
    expect(second).not.toContain("grasa");
    expect(second).not.toContain("null");
  });

  it("ordena ascendente por fecha y devuelve vacío sin mediciones", () => {
    const text = formatBodyComposition([rows[1], rows[0]]);
    expect(text.indexOf("2026-03-22")).toBeLessThan(text.indexOf("2026-04-15"));
    expect(formatBodyComposition([])).toBe("");
    expect(formatBodyComposition(null)).toBe("");
  });
});
