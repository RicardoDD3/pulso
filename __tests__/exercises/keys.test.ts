import { generateExerciseKey, slugifyExerciseLabel } from "@/lib/exercises/keys";

describe("slugifyExerciseLabel", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugifyExerciseLabel("Press Banca")).toBe("press_banca");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugifyExerciseLabel("Curl (biceps)!")).toBe("curl_biceps");
  });

  it("returns empty string when nothing alphanumeric remains", () => {
    expect(slugifyExerciseLabel("¡¡¡")).toBe("");
  });
});

describe("generateExerciseKey", () => {
  it("returns the base slug when unused", () => {
    expect(generateExerciseKey("Sentadillas", [])).toBe("sentadillas");
  });

  it("suffixes _2 on first collision", () => {
    expect(generateExerciseKey("Sentadillas", ["sentadillas"])).toBe("sentadillas_2");
  });

  it("keeps incrementing past existing suffixes", () => {
    expect(
      generateExerciseKey("Sentadillas", ["sentadillas", "sentadillas_2", "sentadillas_3"]),
    ).toBe("sentadillas_4");
  });

  it("returns null for labels with no alphanumeric content", () => {
    expect(generateExerciseKey("***", [])).toBeNull();
  });
});
