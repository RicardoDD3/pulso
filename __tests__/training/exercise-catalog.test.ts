import {
  slugifyExerciseKey,
  computeCatalogMutations,
  type CatalogDef,
  type ExerciseOp,
} from "@/lib/training/exercise-catalog";

// Catálogo default (mismas filas que seedea GET /api/training/exercise-definitions)
function defaultDefs(): CatalogDef[] {
  return [
    { exercise_key: "sentadillas", label: "Sentadillas", type: "bodyweight", is_active: true },
    { exercise_key: "lagartijas", label: "Push Ups", type: "bodyweight", is_active: true },
    { exercise_key: "barras", label: "Barras", type: "bodyweight", is_active: true },
    { exercise_key: "planks", label: "Planks", type: "bodyweight", is_active: true },
    { exercise_key: "press_banca", label: "Bench", type: "weighted", is_active: true },
    { exercise_key: "peso_muerto", label: "Deadlift", type: "weighted", is_active: true },
    { exercise_key: "sentadilla_barra", label: "Squat", type: "weighted", is_active: true },
    { exercise_key: "press_militar", label: "Press Militar", type: "weighted", is_active: true },
  ];
}

describe("slugifyExerciseKey", () => {
  it("genera claves como el POST de exercise-definitions", () => {
    expect(slugifyExerciseKey("PC Clean")).toBe("pc_clean");
    expect(slugifyExerciseKey("Press")).toBe("press");
    expect(slugifyExerciseKey("Sentadilla búlgara")).toBe("sentadilla_blgara");
  });
});

describe("computeCatalogMutations — replace_catalog", () => {
  // Escenario exacto reportado (2026-07-20): "Dentro de fuerza ... solo debe
  // haber estos 5 ejercicios para poder hacer el input en fuerza".
  const op: ExerciseOp = {
    op: "replace_catalog",
    type: "weighted",
    labels: ["Squat", "Press", "Bench", "Deadlift", "PC Clean"],
  };

  it("conserva los existentes que matchean por label, crea los nuevos y desactiva el resto", () => {
    const muts = computeCatalogMutations(defaultDefs(), [op]);

    // Squat/Bench/Deadlift ya existen con esos labels → no se crean de nuevo
    expect(muts.creates.map((c) => c.exercise_key).sort()).toEqual(["pc_clean", "press"]);
    // press_militar es el único weighted activo que sobra
    expect(muts.updates).toEqual([
      { exercise_key: "press_militar", changes: { is_active: false } },
    ]);
  });

  it("no toca los ejercicios bodyweight al reemplazar el catálogo de pesas", () => {
    const muts = computeCatalogMutations(defaultDefs(), [op]);
    const touched = [
      ...muts.creates.map((c) => c.exercise_key),
      ...muts.updates.map((u) => u.exercise_key),
    ];
    for (const key of ["sentadillas", "lagartijas", "barras", "planks"]) {
      expect(touched).not.toContain(key);
    }
  });

  it("reactiva un ejercicio oculto si vuelve a estar en la lista", () => {
    const defs = defaultDefs();
    defs.find((d) => d.exercise_key === "press_banca")!.is_active = false;
    const muts = computeCatalogMutations(defs, [op]);
    expect(muts.updates).toContainEqual({
      exercise_key: "press_banca",
      changes: { is_active: true },
    });
  });

  it("matchea labels sin importar mayúsculas ni acentos", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "replace_catalog", type: "weighted", labels: ["squat", "BENCH", "deadlift", "press militar"] },
    ]);
    expect(muts.creates).toEqual([]);
    expect(muts.updates).toEqual([]);
  });

  it("los creates de pesas llevan defaults (emoji, increment 5) y claves únicas", () => {
    const muts = computeCatalogMutations(defaultDefs(), [op]);
    for (const c of muts.creates) {
      expect(c.type).toBe("weighted");
      expect(c.increment).toBe(5);
      expect(c.emoji).toBeTruthy();
      expect(c.color).toBeTruthy();
    }
    const keys = muts.creates.map((c) => c.exercise_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("computeCatalogMutations — ops individuales", () => {
  it("add crea un ejercicio nuevo con clave slug", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "add", type: "weighted", label: "PC Clean" },
    ]);
    expect(muts.creates).toHaveLength(1);
    expect(muts.creates[0]).toMatchObject({ exercise_key: "pc_clean", label: "PC Clean", type: "weighted" });
  });

  it("add de un label ya existente activo no duplica", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "add", type: "weighted", label: "Squat" },
    ]);
    expect(muts.creates).toEqual([]);
    expect(muts.updates).toEqual([]);
  });

  it("add de un label existente pero oculto lo reactiva", () => {
    const defs = defaultDefs();
    defs.find((d) => d.exercise_key === "peso_muerto")!.is_active = false;
    const muts = computeCatalogMutations(defs, [
      { op: "add", type: "weighted", label: "Deadlift" },
    ]);
    expect(muts.creates).toEqual([]);
    expect(muts.updates).toEqual([{ exercise_key: "peso_muerto", changes: { is_active: true } }]);
  });

  it("add con clave en conflicto genera sufijo _2", () => {
    const defs: CatalogDef[] = [
      { exercise_key: "press", label: "Press hombro", type: "weighted", is_active: true },
    ];
    const muts = computeCatalogMutations(defs, [
      { op: "add", type: "bodyweight", label: "Press" },
    ]);
    expect(muts.creates[0].exercise_key).toBe("press_2");
  });

  it("deactivate oculta y reactivate recupera", () => {
    const defs = defaultDefs();
    defs.find((d) => d.exercise_key === "barras")!.is_active = false;
    const muts = computeCatalogMutations(defs, [
      { op: "deactivate", exercise: "planks" },
      { op: "reactivate", exercise: "barras" },
    ]);
    expect(muts.updates).toEqual([
      { exercise_key: "planks", changes: { is_active: false } },
      { exercise_key: "barras", changes: { is_active: true } },
    ]);
  });

  it("deactivate de una clave inexistente no genera mutación", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "deactivate", exercise: "no_existe" },
    ]);
    expect(muts.updates).toEqual([]);
    expect(muts.creates).toEqual([]);
  });

  it("set_goal redondea y acepta null", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "set_goal", exercise: "sentadillas", weekly_goal: 199.6 },
      { op: "set_goal", exercise: "planks", weekly_goal: null },
    ]);
    expect(muts.updates).toEqual([
      { exercise_key: "sentadillas", changes: { weekly_goal: 200 } },
      { exercise_key: "planks", changes: { weekly_goal: null } },
    ]);
  });

  it("genera líneas de resumen legibles para el chat", () => {
    const muts = computeCatalogMutations(defaultDefs(), [
      { op: "replace_catalog", type: "weighted", labels: ["Squat", "PC Clean"] },
    ]);
    expect(muts.summary.length).toBeGreaterThan(0);
    expect(muts.summary.join("\n")).toContain("PC Clean");
  });
});
