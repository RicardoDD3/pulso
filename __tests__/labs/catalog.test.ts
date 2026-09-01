import { normalizeTestName, toCanonicalUnit } from "@/lib/labs/catalog";

describe("normalizeTestName", () => {
  it("normalizes Spanish and English aliases to one key", () => {
    expect(normalizeTestName("Glucosa")).toBe("glucose");
    expect(normalizeTestName("GLUCOSE")).toBe("glucose");
    expect(normalizeTestName("GLU")).toBe("glucose");
  });

  it("ignores accents and extra whitespace", () => {
    expect(normalizeTestName("  Ácido   Úrico ")).toBe("uric_acid");
    expect(normalizeTestName("Trigliceridos")).toBe("triglycerides");
  });

  it("returns null for unknown analytes (result is stored anyway)", () => {
    expect(normalizeTestName("Totally Unknown Marker")).toBeNull();
    expect(normalizeTestName("")).toBeNull();
    expect(normalizeTestName(null)).toBeNull();
  });
});

describe("toCanonicalUnit", () => {
  it("converts glucose mmol/L → mg/dL", () => {
    const r = toCanonicalUnit(5.5, "mmol/L", "glucose");
    expect(r.converted).toBe(true);
    expect(r.unit).toBe("mg/dL");
    expect(r.value).toBeCloseTo(99.09, 1);
  });

  it("converts cholesterol mmol/L → mg/dL", () => {
    const r = toCanonicalUnit(5.0, "mmol/L", "total_cholesterol");
    expect(r.value).toBeCloseTo(193.35, 1);
  });

  it("leaves canonical units untouched", () => {
    const r = toCanonicalUnit(95, "mg/dL", "glucose");
    expect(r.converted).toBe(false);
    expect(r.value).toBe(95);
  });

  it("passes through unknown unit pairs unchanged (never lossy)", () => {
    const r = toCanonicalUnit(42, "weird/unit", "glucose");
    expect(r.converted).toBe(false);
    expect(r.value).toBe(42);
    expect(r.unit).toBe("weird/unit");
  });

  it("passes through unknown analytes unchanged", () => {
    const r = toCanonicalUnit(1.2, "mg/dL", "not_in_catalog");
    expect(r.converted).toBe(false);
  });
});
