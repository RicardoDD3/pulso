import { parseIntent, parseIntents, buildIntentPrompt } from "@/lib/training/planner-intent";

describe("parseIntent", () => {
  it("parsea answer", () => {
    expect(parseIntent('{"action":"answer"}')).toEqual({ action: "answer" });
  });
  it("parsea modify_plan con instruction", () => {
    expect(parseIntent('{"action":"modify_plan","instruction":"alarga la semana 20"}')).toEqual({
      action: "modify_plan",
      instruction: "alarga la semana 20",
    });
  });
  it("modify_plan sin instruction cae a answer", () => {
    expect(parseIntent('{"action":"modify_plan"}')).toEqual({ action: "answer" });
  });
  it("parsea rename_plan con name", () => {
    expect(parseIntent('{"action":"rename_plan","name":"Mi ultra 2026"}')).toEqual({
      action: "rename_plan",
      name: "Mi ultra 2026",
    });
  });
  it("rename_plan sin name (o vacío) cae a answer", () => {
    expect(parseIntent('{"action":"rename_plan"}')).toEqual({ action: "answer" });
    expect(parseIntent('{"action":"rename_plan","name":"  "}')).toEqual({ action: "answer" });
  });
  it("parsea log_workout válido", () => {
    const r = parseIntent('{"action":"log_workout","workout":{"title":"Fuerza tren superior","workout_type":"strength"}}');
    expect(r).toEqual({ action: "log_workout", workout: { title: "Fuerza tren superior", workout_type: "strength" } });
  });
  it("log_workout sin title cae a answer", () => {
    expect(parseIntent('{"action":"log_workout","workout":{"workout_type":"strength"}}')).toEqual({ action: "answer" });
  });
  it("parsea log_exercise weighted", () => {
    const r = parseIntent('{"action":"log_exercise","exercise":{"kind":"weighted","exercise":"press_banca","weight_kg":60,"reps":10}}');
    expect(r).toEqual({ action: "log_exercise", exercise: { kind: "weighted", exercise: "press_banca", weight_kg: 60, reps: 10 } });
  });
  it("parsea log_exercise bodyweight", () => {
    const r = parseIntent('{"action":"log_exercise","exercise":{"kind":"bodyweight","exercise":"push_ups","reps":40}}');
    expect(r).toEqual({ action: "log_exercise", exercise: { kind: "bodyweight", exercise: "push_ups", reps: 40 } });
  });
  it("log_exercise weighted sin weight_kg cae a answer", () => {
    expect(parseIntent('{"action":"log_exercise","exercise":{"kind":"weighted","exercise":"x","reps":10}}')).toEqual({ action: "answer" });
  });
  it("parsea undo", () => {
    expect(parseIntent('{"action":"undo"}')).toEqual({ action: "undo" });
  });
  it("parsea set_steps_goal con min y max", () => {
    expect(parseIntent('{"action":"set_steps_goal","min":180000,"max":220000}')).toEqual({
      action: "set_steps_goal",
      min: 180000,
      max: 220000,
    });
  });
  it("parsea set_steps_goal con solo min (max null)", () => {
    expect(parseIntent('{"action":"set_steps_goal","min":180000}')).toEqual({
      action: "set_steps_goal",
      min: 180000,
      max: null,
    });
    expect(parseIntent('{"action":"set_steps_goal","min":180000,"max":null}')).toEqual({
      action: "set_steps_goal",
      min: 180000,
      max: null,
    });
  });
  it("parsea set_steps_goal con solo max", () => {
    expect(parseIntent('{"action":"set_steps_goal","max":250000}')).toEqual({
      action: "set_steps_goal",
      min: null,
      max: 250000,
    });
  });
  it("set_steps_goal sin valores válidos cae a answer", () => {
    expect(parseIntent('{"action":"set_steps_goal"}')).toEqual({ action: "answer" });
    expect(parseIntent('{"action":"set_steps_goal","min":0,"max":-5}')).toEqual({ action: "answer" });
    expect(parseIntent('{"action":"set_steps_goal","min":"abc"}')).toEqual({ action: "answer" });
  });
  it("parsea edit_exercises con replace_catalog (caso 'solo estos 5 en fuerza')", () => {
    const r = parseIntent(
      '{"action":"edit_exercises","ops":[{"op":"replace_catalog","type":"weighted","labels":["Squat","Press","Bench","Deadlift","PC Clean"]}]}'
    );
    expect(r).toEqual({
      action: "edit_exercises",
      ops: [
        { op: "replace_catalog", type: "weighted", labels: ["Squat", "Press", "Bench", "Deadlift", "PC Clean"] },
      ],
    });
  });
  it("parsea edit_exercises con add/deactivate/set_goal", () => {
    const r = parseIntent(
      '{"action":"edit_exercises","ops":[{"op":"add","type":"weighted","label":"PC Clean","emoji":"🏋️"},{"op":"deactivate","exercise":"press_militar"},{"op":"set_goal","exercise":"sentadillas","weekly_goal":200}]}'
    );
    expect(r).toEqual({
      action: "edit_exercises",
      ops: [
        { op: "add", type: "weighted", label: "PC Clean", emoji: "🏋️" },
        { op: "deactivate", exercise: "press_militar" },
        { op: "set_goal", exercise: "sentadillas", weekly_goal: 200 },
      ],
    });
  });
  it("edit_exercises descarta ops mal formadas y conserva las válidas", () => {
    const r = parseIntent(
      '{"action":"edit_exercises","ops":[{"op":"add","type":"laser","label":"X"},{"op":"deactivate","exercise":"planks"}]}'
    );
    expect(r).toEqual({
      action: "edit_exercises",
      ops: [{ op: "deactivate", exercise: "planks" }],
    });
  });
  it("edit_exercises sin ninguna op válida cae a answer", () => {
    expect(parseIntent('{"action":"edit_exercises","ops":[]}')).toEqual({ action: "answer" });
    expect(parseIntent('{"action":"edit_exercises","ops":[{"op":"add"}]}')).toEqual({ action: "answer" });
    expect(parseIntent('{"action":"edit_exercises"}')).toEqual({ action: "answer" });
  });
  it("extrae JSON de un bloque con ```json", () => {
    expect(parseIntent('```json\n{"action":"undo"}\n```')).toEqual({ action: "undo" });
  });
  it("extrae JSON aunque venga con texto alrededor", () => {
    expect(parseIntent('Claro, aquí tienes: {"action":"undo"} listo')).toEqual({ action: "undo" });
  });
  it("JSON corrupto cae a answer", () => {
    expect(parseIntent("no soy json")).toEqual({ action: "answer" });
  });
  it("acción desconocida cae a answer", () => {
    expect(parseIntent('{"action":"borrar_todo"}')).toEqual({ action: "answer" });
  });
});

// Regression 2026-07-20 (2ª ronda): "incorpora un ejercicio de sentadilla
// búlgara y los domingos son días de descanso" solo ejecutó modify_plan — el
// router devolvía UNA acción y el ejercicio nunca se creó. parseIntents acepta
// {"actions":[...]} y ejecuta todas en orden.
describe("parseIntents — mensajes compuestos", () => {
  it("parsea varias acciones (caso ejercicio + descanso dominical)", () => {
    const r = parseIntents(
      '{"actions":[{"action":"edit_exercises","ops":[{"op":"add","type":"weighted","label":"Sentadilla Búlgara"}]},{"action":"modify_plan","instruction":"los domingos son días de descanso, redistribuye los km"}]}'
    );
    expect(r).toEqual([
      {
        action: "edit_exercises",
        ops: [{ op: "add", type: "weighted", label: "Sentadilla Búlgara" }],
      },
      { action: "modify_plan", instruction: "los domingos son días de descanso, redistribuye los km" },
    ]);
  });

  it("una acción suelta devuelve un array de una", () => {
    expect(parseIntents('{"action":"undo"}')).toEqual([{ action: "undo" }]);
  });

  it("descarta acciones inválidas del array y conserva las válidas", () => {
    const r = parseIntents(
      '{"actions":[{"action":"rename_plan"},{"action":"undo"}]}'
    );
    expect(r).toEqual([{ action: "undo" }]);
  });

  it("array vacío o basura cae a [answer]", () => {
    expect(parseIntents('{"actions":[]}')).toEqual([{ action: "answer" }]);
    expect(parseIntents("no soy json")).toEqual([{ action: "answer" }]);
  });

  it("si todas las acciones válidas son answer, colapsa a [answer]", () => {
    expect(parseIntents('{"actions":[{"action":"answer"},{"action":"answer"}]}')).toEqual([
      { action: "answer" },
    ]);
  });
});

describe("buildIntentPrompt", () => {
  it("incluye el mensaje, el resumen del plan y pide SOLO JSON", () => {
    const { systemPrompt, userMessage } = buildIntentPrompt("registra 40 push ups", "Plan: Ultra 2026", []);
    expect(systemPrompt).toContain("JSON");
    expect(systemPrompt).toContain("modify_plan");
    expect(systemPrompt).toContain("Plan: Ultra 2026");
    expect(userMessage).toContain("registra 40 push ups");
  });
  it("incluye historial reciente (últimos 6)", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `msg${i}` }));
    const { systemPrompt } = buildIntentPrompt("hola", "Plan X", history);
    expect(systemPrompt).toContain("msg9");
    expect(systemPrompt).not.toContain("msg3");
  });
  it("documenta la forma compuesta {actions:[...]}", () => {
    const { systemPrompt } = buildIntentPrompt("crea un ejercicio y descansa domingos", "Plan X", []);
    expect(systemPrompt).toContain('"actions"');
    expect(systemPrompt).toContain("varias cosas");
  });
  it("documenta edit_exercises e incluye el catálogo del usuario", () => {
    const catalog = "- press_banca — Bench (pesas)\n- sentadillas — Sentadillas (cuerpo)";
    const { systemPrompt } = buildIntentPrompt("solo quiero 5 ejercicios de fuerza", "Plan X", [], catalog);
    expect(systemPrompt).toContain("edit_exercises");
    expect(systemPrompt).toContain("replace_catalog");
    expect(systemPrompt).toContain("press_banca — Bench");
  });

  // Sin la fecha de hoy, "ayer hice 3 series" caía al default (hoy) y el
  // registro quedaba en el día equivocado.
  it("incluye la fecha de hoy para resolver fechas relativas", () => {
    const { systemPrompt } = buildIntentPrompt(
      "ayer hice 3 series de 60 kg en press banca",
      "Plan X",
      [],
      undefined,
      "HOY: 2026-08-05 (Mié) — SEMANA EN CURSO: 23 (inicia 2026-08-03)."
    );
    expect(systemPrompt).toContain("2026-08-05");
    expect(systemPrompt).toContain("SEMANA EN CURSO: 23");
    expect(systemPrompt).toMatch(/ayer|relativa/i);
  });

  it("funciona sin ancla de fecha (compatibilidad)", () => {
    const { systemPrompt } = buildIntentPrompt("registra 40 push ups", "Plan X", []);
    expect(systemPrompt).toContain("log_exercise");
    expect(systemPrompt).not.toContain("SEMANA EN CURSO");
  });
});
