import { labExtractionSchema, MAX_LAB_RESULTS } from "@/lib/labs/schema";

const validResult = {
  cat: "GM",
  name: "Glucosa",
  key: "glucose",
  val: 92,
  txt: null,
  unit: "mg/dL",
  rmin: 70,
  rmax: 100,
  rtxt: null,
  flag: false,
};

describe("labExtractionSchema", () => {
  it("accepts a well-formed extraction", () => {
    const parsed = labExtractionSchema.parse({
      patient: { name: "X", dob: "1990-01-01", sex: "M", age: 36 },
      lab: { name: "Lab", location: "CDMX", doctor: null },
      sample_date: "2026-01-15",
      results: [validResult],
    });
    expect(parsed.results).toHaveLength(1);
  });

  it("coerces unknown categories to OM instead of dropping the result", () => {
    const parsed = labExtractionSchema.parse({
      patient: null,
      lab: null,
      sample_date: null,
      results: [{ ...validResult, cat: "WEIRD" }],
    });
    expect(parsed.results[0].cat).toBe("OM");
  });

  it("caps results at MAX_LAB_RESULTS", () => {
    const results = Array.from({ length: MAX_LAB_RESULTS + 1 }, () => validResult);
    expect(() =>
      labExtractionSchema.parse({ patient: null, lab: null, sample_date: null, results }),
    ).toThrow();
  });

  it("rejects an empty results array (garbage PDF → failed session)", () => {
    expect(() =>
      labExtractionSchema.parse({ patient: null, lab: null, sample_date: null, results: [] }),
    ).toThrow();
  });

  it("tolerates malformed optional fields via catch (never loses the row)", () => {
    const parsed = labExtractionSchema.parse({
      patient: null,
      lab: null,
      sample_date: "not-a-date",
      results: [{ ...validResult, val: "high", flag: "yes" }],
    });
    expect(parsed.sample_date).toBeNull();
    expect(parsed.results[0].val).toBeNull();
    expect(parsed.results[0].flag).toBe(false);
  });
});
