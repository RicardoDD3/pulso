import {
  formatStrengthLog,
  type StrengthSetRow,
  type BodyweightLogRow,
  type StrengthDef,
} from "@/lib/training/strength-summary";

/**
 * Bloque de FUERZA REGISTRADA para los prompts de los 3 chats de Training.
 *
 * Antes, `fetchHealthData` leía `training_workouts` pero nunca `exercise_sets`
 * (pesas) ni `exercise_logs` (reps de peso corporal): ningún chat veía la
 * fuerza que el usuario registra desde la app.
 */

const DEFS: StrengthDef[] = [
  { exercise_key: "press_banca", label: "Press de banca", type: "weighted", weekly_goal: null },
  { exercise_key: "peso_muerto", label: "Peso muerto", type: "weighted", weekly_goal: null },
  { exercise_key: "barras", label: "Barras", type: "bodyweight", weekly_goal: 300 },
  { exercise_key: "push_ups", label: "Push ups", type: "bodyweight", weekly_goal: 500 },
];

// Semana en curso: lunes 2026-08-03 … hoy miércoles 2026-08-05.
const TODAY = "2026-08-05";

function set(
  date: string,
  exercise: string,
  weight_kg: number,
  reps: number,
  set_number = 1
): StrengthSetRow {
  return { date, exercise, weight_kg, reps, set_number };
}

describe("formatStrengthLog — estado vacío", () => {
  it("lo dice explícitamente cuando no hay nada registrado", () => {
    const out = formatStrengthLog([], [], DEFS, TODAY);
    expect(out).toMatch(/sin fuerza registrada/i);
  });
});

describe("formatStrengthLog — semana en curso", () => {
  const sets = [
    set("2026-08-03", "press_banca", 60, 10, 1),
    set("2026-08-03", "press_banca", 60, 8, 2),
    set("2026-08-03", "press_banca", 65, 6, 3),
    set("2026-08-05", "peso_muerto", 100, 5, 1),
  ];
  const logs: BodyweightLogRow[] = [{ date: "2026-08-03", exercise: "barras", reps: 120 }];

  it("lista cada día de la semana con sus series y reps", () => {
    const out = formatStrengthLog(sets, logs, DEFS, TODAY);
    expect(out).toContain("2026-08-03");
    expect(out).toContain("Press de banca");
    expect(out).toContain("60×10");
    expect(out).toContain("65×6");
    expect(out).toContain("Barras 120 reps");
  });

  it("marca los días de la semana ya transcurridos sin registro", () => {
    const out = formatStrengthLog(sets, logs, DEFS, TODAY);
    // Martes 04: nada registrado.
    expect(out).toMatch(/2026-08-04.*sin registro/);
  });

  it("no inventa los días futuros de la semana", () => {
    const out = formatStrengthLog(sets, logs, DEFS, TODAY);
    expect(out).not.toContain("2026-08-06");
    expect(out).not.toContain("2026-08-09");
  });

  it("usa la clave cuando el ejercicio no está en el catálogo", () => {
    const out = formatStrengthLog([set("2026-08-03", "remo_invertido", 40, 12)], [], DEFS, TODAY);
    expect(out).toContain("remo_invertido");
  });
});

describe("formatStrengthLog — resumen por semana", () => {
  it("cuenta sesiones, series y tonelaje por semana", () => {
    const sets = [
      // Semana previa (lunes 2026-07-27): 2 días, 3 series.
      set("2026-07-27", "press_banca", 60, 10, 1),
      set("2026-07-27", "press_banca", 60, 10, 2),
      set("2026-07-29", "peso_muerto", 100, 5, 1),
      // Semana en curso.
      set("2026-08-03", "press_banca", 60, 10, 1),
    ];
    const out = formatStrengthLog(sets, [], DEFS, TODAY);
    // 60×10 + 60×10 + 100×5 = 1,700 kg
    expect(out).toMatch(/2026-07-27.*2 sesiones.*3 series.*1,700 kg/);
  });

  it("suma las reps de peso corporal de la semana", () => {
    const logs: BodyweightLogRow[] = [
      { date: "2026-07-27", exercise: "barras", reps: 60 },
      { date: "2026-07-29", exercise: "barras", reps: 40 },
    ];
    const out = formatStrengthLog([], logs, DEFS, TODAY);
    expect(out).toMatch(/2026-07-27.*100 reps/);
  });

  it("ordena las semanas de la más reciente a la más vieja", () => {
    const sets = [
      set("2026-07-20", "press_banca", 60, 10),
      set("2026-07-27", "press_banca", 60, 10),
    ];
    const out = formatStrengthLog(sets, [], DEFS, TODAY);
    expect(out.indexOf("2026-07-27")).toBeLessThan(out.indexOf("2026-07-20"));
  });
});

describe("formatStrengthLog — récords", () => {
  it("reporta el peso máximo por ejercicio con su fecha", () => {
    const sets = [
      set("2026-06-18", "press_banca", 70, 3),
      set("2026-07-27", "press_banca", 60, 10),
      set("2026-07-02", "peso_muerto", 110, 2),
    ];
    const out = formatStrengthLog(sets, [], DEFS, TODAY);
    expect(out).toContain("Press de banca 70 kg (2026-06-18)");
    expect(out).toContain("Peso muerto 110 kg (2026-07-02)");
  });

  it("ignora series sin peso", () => {
    const sets = [{ date: "2026-07-27", exercise: "press_banca", weight_kg: null, reps: 10 }];
    const out = formatStrengthLog(sets, [], DEFS, TODAY);
    expect(out).not.toMatch(/Récords/);
  });
});

describe("formatStrengthLog — metas de peso corporal", () => {
  it("compara las reps de la semana en curso contra la meta semanal", () => {
    const logs: BodyweightLogRow[] = [
      { date: "2026-08-03", exercise: "barras", reps: 120 },
      { date: "2026-08-04", exercise: "barras", reps: 90 },
      { date: "2026-08-03", exercise: "push_ups", reps: 480 },
    ];
    const out = formatStrengthLog([], logs, DEFS, TODAY);
    expect(out).toContain("Barras 210/300");
    expect(out).toContain("Push ups 480/500");
  });

  it("no cuenta reps de semanas anteriores en la meta de la semana en curso", () => {
    const logs: BodyweightLogRow[] = [
      { date: "2026-07-27", exercise: "barras", reps: 500 },
      { date: "2026-08-03", exercise: "barras", reps: 50 },
    ];
    const out = formatStrengthLog([], logs, DEFS, TODAY);
    expect(out).toContain("Barras 50/300");
  });

  it("omite la sección si ningún ejercicio tiene meta", () => {
    const defs = DEFS.map((d) => ({ ...d, weekly_goal: null }));
    const logs: BodyweightLogRow[] = [{ date: "2026-08-03", exercise: "barras", reps: 120 }];
    const out = formatStrengthLog([], logs, defs, TODAY);
    expect(out).not.toMatch(/meta semanal/i);
  });
});
