import { sumIntensity, lastNonNull } from "@/lib/health/trends";

describe("sumIntensity", () => {
  it("adds moderate and vigorous minutes", () => {
    expect(sumIntensity(16, 73)).toBe(89);
  });

  it("treats a null/undefined component as 0 when the other has data", () => {
    expect(sumIntensity(30, null)).toBe(30);
    expect(sumIntensity(null, 40)).toBe(40);
    expect(sumIntensity(undefined, 12)).toBe(12);
  });

  it("returns null only when BOTH components are missing", () => {
    expect(sumIntensity(null, null)).toBeNull();
    expect(sumIntensity(undefined, undefined)).toBeNull();
  });

  it("keeps 0 as a real value (rest day), not null", () => {
    expect(sumIntensity(0, 0)).toBe(0);
  });

  it("coerces string numerics (Supabase) to number", () => {
    expect(sumIntensity("5" as unknown as number, "10" as unknown as number)).toBe(15);
  });
});

describe("lastNonNull", () => {
  it("returns the last defined value in the series", () => {
    expect(lastNonNull([32, 33, 35])).toBe(35);
  });

  it("skips trailing nulls/undefined", () => {
    expect(lastNonNull([32, 35, null, undefined])).toBe(35);
  });

  it("returns null for empty or all-null series", () => {
    expect(lastNonNull([])).toBeNull();
    expect(lastNonNull([null, undefined])).toBeNull();
  });

  it("preserves 0 as a valid last value", () => {
    expect(lastNonNull([5, 0])).toBe(0);
  });

  it("coerces string numerics (Supabase serializes numeric/bigint as strings)", () => {
    // Number() en lastNonNull es load-bearing: total_calories/hrv/respiration
    // pueden llegar como string desde PostgREST y luego van a .toLocaleString().
    expect(lastNonNull(["2500"] as unknown as Array<number | null>)).toBe(2500);
    expect(lastNonNull([null, "20"] as unknown as Array<number | null>)).toBe(20);
  });
});
