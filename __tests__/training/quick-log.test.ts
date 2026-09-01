import {
  DEFAULT_SETS,
  DEFAULT_REPS,
  MAX_SETS_PER_ENTRY,
  parseSetEntry,
  formatAddSetsLabel,
} from "@/lib/training/quick-log";

describe("defaults", () => {
  test("el registro rápido de pesas arranca en 3 sets × 5 reps", () => {
    expect(DEFAULT_SETS).toBe(3);
    expect(DEFAULT_REPS).toBe(5);
  });
});

describe("parseSetEntry", () => {
  test("acepta una entrada válida", () => {
    expect(parseSetEntry({ weight: "150", sets: "3", reps: "5" })).toEqual({
      ok: true,
      weightKg: 150,
      sets: 3,
      reps: 5,
    });
  });

  test("acepta peso decimal y peso 0 (barra sola / peso corporal)", () => {
    expect(parseSetEntry({ weight: "22.5", sets: "1", reps: "12" })).toEqual({
      ok: true,
      weightKg: 22.5,
      sets: 1,
      reps: 12,
    });
    expect(parseSetEntry({ weight: "0", sets: "2", reps: "8" })).toMatchObject({ ok: true, weightKg: 0 });
  });

  test("rechaza peso vacío, no numérico, negativo o > 1000 (límite de la API)", () => {
    for (const weight of ["", "  ", "abc", "-1", "1001"]) {
      expect(parseSetEntry({ weight, sets: "3", reps: "5" })).toEqual({
        ok: false,
        error: "Peso inválido",
      });
    }
  });

  test("rechaza sets fuera de 1..20", () => {
    for (const sets of ["0", "-2", "21", "", "x"]) {
      expect(parseSetEntry({ weight: "150", sets, reps: "5" })).toEqual({
        ok: false,
        error: `Sets debe ser entre 1 y ${MAX_SETS_PER_ENTRY}`,
      });
    }
  });

  test("rechaza reps fuera de 1..200", () => {
    for (const reps of ["0", "-5", "201", "", "x"]) {
      expect(parseSetEntry({ weight: "150", sets: "3", reps })).toEqual({
        ok: false,
        error: "Reps debe ser entre 1 y 200",
      });
    }
  });

  test("trunca sets y reps decimales en vez de aceptarlos a medias", () => {
    expect(parseSetEntry({ weight: "150", sets: "3.7", reps: "5.9" })).toEqual({
      ok: true,
      weightKg: 150,
      sets: 3,
      reps: 5,
    });
  });

  test("el peso se valida antes que los sets (un solo error a la vez)", () => {
    expect(parseSetEntry({ weight: "", sets: "0", reps: "0" })).toEqual({
      ok: false,
      error: "Peso inválido",
    });
  });
});

describe("formatAddSetsLabel", () => {
  test("describe lo que va a guardar el botón", () => {
    expect(formatAddSetsLabel("3", "5")).toBe("+ 3 sets × 5 reps");
  });

  test("singulariza un solo set", () => {
    expect(formatAddSetsLabel("1", "12")).toBe("+ 1 set × 12 reps");
  });

  test("cae a un texto genérico si la entrada no es válida todavía", () => {
    expect(formatAddSetsLabel("", "5")).toBe("+ Sets");
    expect(formatAddSetsLabel("3", "")).toBe("+ Sets");
  });
});
