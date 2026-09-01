import {
  BLOCK_ANNOUNCEMENTS,
  buildCoachSystemPrompt,
  computeAge,
  formatBiomarcadoresResults,
  formatFlaggedHistory,
  formatGarminSummary,
  formatProfileBlock,
  formatTrainingData,
  type CoachMode,
} from "@/lib/health/coach-prompt";
import { HEALTH_WINDOW_DAYS } from "@/lib/health/health-window";
import { dateInTz, daysBefore, todayInTz } from "@/lib/health/tz";

/**
 * Port de __tests__/biomarcadores/coach-prompt.test.ts de el-consejo, adaptado
 * a los dos cambios del port (spec doc 08):
 * - "hoy" es un parámetro de formatTrainingData (determinismo por día).
 * - Las instrucciones que anuncian bloques crudos solo se emiten cuando su
 *   bloque está presente — los tests que las asertan pasan datos que contienen
 *   los encabezados reales.
 */

/** Datos con TODOS los encabezados de bloque que la instrucción puede anunciar. */
const FULL_GARMIN = [
  "Estadísticas completas por métrica (ventanas 7/30/90 días hasta 2026-07-20):",
  "REGISTRO DIARIO COMPLETO (una línea por día, dato crudo del reloj):",
  "PASOS (meta semanal del usuario: 150,000–200,000; meta diaria ≈ 21,429):",
  "COMPOSICIÓN CORPORAL (historial completo de báscula):",
  "BODY BATTERY Y ESTRÉS INTRADÍA (últimos días, resumen de las muestras del reloj):",
].join("\n\n");

const FULL_TRAINING = [
  'Plan activo: "Ultra 2026"',
  "HOY: 2026-07-22 (Mié) — SEMANA EN CURSO: 23 (inicia 2026-07-20).",
  "Carreras (todas las del periodo, 4, de la más reciente a la más vieja):",
  "  Por intensidad (clasificación por FC):",
  "Curva FC intradía de los días con carrera (muestras del reloj cada ~2 min, hora local del usuario):",
  "FUERZA REGISTRADA (últimos 90 días):",
].join("\n");

const DETAIL = "[2026-07-21] Miguel Hidalgo Carrera (running) · 7.40km\n  Vueltas (22): L1 Intervalo 0.97km 4:37 122/156♥";

describe("buildCoachSystemPrompt", () => {
  const garmin = "Pasos: 10000";
  const bio = "Colesterol Total: 259 mg/dL";
  const training = "Plan activo: Ultra 2026";

  it("biohacking mode (default) includes the lab section, its data, and proactive biomarker guidance", () => {
    const prompt = buildCoachSystemPrompt(garmin, bio, training);
    expect(prompt).toContain("=== DATOS DE LABORATORIO (última sesión) ===");
    expect(prompt).toContain(bio);
    expect(prompt).toContain(garmin);
    expect(prompt).toContain(training);
    // Biohacking coach is explicitly told to raise out-of-range biomarkers
    expect(prompt).toContain("menciónalo proactivamente");
  });

  it("training mode omits the lab section and the proactive-biomarker instruction", () => {
    const prompt = buildCoachSystemPrompt(garmin, bio, training, "training");
    expect(prompt).not.toContain("=== DATOS DE LABORATORIO (última sesión) ===");
    expect(prompt).not.toContain(bio);
    expect(prompt).not.toContain("menciónalo proactivamente");
    // Still keeps Garmin + training context
    expect(prompt).toContain(garmin);
    expect(prompt).toContain(training);
  });

  it("training mode forbids clinical data and the word 'rodaje'", () => {
    const prompt = buildCoachSystemPrompt(garmin, bio, training, "training");
    expect(prompt).toContain("NUNCA menciones datos clínicos");
    expect(prompt).toMatch(/NUNCA uses la palabra "rodaje"/);
  });

  it("training mode is read-only: forbids modifying the plan or claiming to", () => {
    const prompt = buildCoachSystemPrompt(garmin, bio, training, "training");
    expect(prompt).toContain("SOLO consulta");
    expect(prompt).toContain("NO puedes modificar el plan");
    expect(prompt).toContain("Nunca afirmes haber modificado nada");
  });

  it("planner mode: editor con contexto completo (garmin + lab + training)", () => {
    const prompt = buildCoachSystemPrompt(garmin, bio, training, "planner");
    expect(prompt).toContain(garmin);
    expect(prompt).toContain(bio);
    expect(prompt).toContain(training);
    expect(prompt).toContain("editor");
    expect(prompt).toContain("MODIFICAR");
  });

  it("includes the recent-activities detail section (laps) in every mode when provided", () => {
    for (const mode of ["biohacking", "training", "planner"] as CoachMode[]) {
      const prompt = buildCoachSystemPrompt(garmin, bio, training, mode, DETAIL);
      expect(prompt).toContain("=== DETALLE DE ACTIVIDADES (últimos 15 días");
      expect(prompt).toContain("Vueltas (22):");
    }
    // Sin el bloque no se agrega la sección.
    expect(buildCoachSystemPrompt(garmin, bio, training, "training")).not.toContain("=== DETALLE DE ACTIVIDADES");
  });

  it("the two modes produce materially different prompts", () => {
    const bh = buildCoachSystemPrompt(garmin, bio, training, "biohacking");
    const tr = buildCoachSystemPrompt(garmin, bio, training, "training");
    expect(bh).not.toEqual(tr);
  });

  it("falls back to placeholder copy when sections are empty — biohacking branch", () => {
    const prompt = buildCoachSystemPrompt("", "", "");
    expect(prompt).toContain("No hay datos de Garmin disponibles.");
    expect(prompt).toContain("No hay resultados de laboratorio disponibles.");
    expect(prompt).toContain("No hay datos de entrenamiento disponibles.");
  });

  it("falls back to placeholder copy when sections are empty — training branch", () => {
    const prompt = buildCoachSystemPrompt("", "", "", "training");
    expect(prompt).toContain("No hay datos de Garmin disponibles.");
    expect(prompt).toContain("No hay datos de entrenamiento disponibles.");
    // No lab placeholder because training mode drops the lab section entirely
    expect(prompt).not.toContain("No hay resultados de laboratorio disponibles.");
  });

  it("accepts CoachMode type for both modes", () => {
    const modes: CoachMode[] = ["biohacking", "training"];
    expect(modes).toHaveLength(2);
  });
});

describe("buildCoachSystemPrompt — determinismo e idioma", () => {
  it("mismos datos → prompt byte-idéntico (regla dura del doc 08)", () => {
    const a = buildCoachSystemPrompt(FULL_GARMIN, "bio", FULL_TRAINING, "planner", DETAIL, "es", "HOY: 2026-07-22 (Mié).");
    const b = buildCoachSystemPrompt(FULL_GARMIN, "bio", FULL_TRAINING, "planner", DETAIL, "es", "HOY: 2026-07-22 (Mié).");
    expect(b).toBe(a);
  });

  it("instruye el idioma de respuesta desde el locale del perfil, al final", () => {
    const es = buildCoachSystemPrompt("g", "b", "t");
    expect(es.trimEnd().endsWith("Responde en el idioma del usuario: es.")).toBe(true);
    const en = buildCoachSystemPrompt("g", "b", "t", "training", undefined, "en");
    expect(en).toContain("Responde en el idioma del usuario: en.");
    expect(en).not.toContain("Responde en español");
  });

  it("incluye el bloque de perfil y ancla temporal cuando se provee", () => {
    const profile = "Edad: 34 | Sexo: M\nZona horaria: America/Mexico_City\nHOY: 2026-07-22 (Mié).";
    const prompt = buildCoachSystemPrompt("g", "b", "t", "biohacking", undefined, "es", profile);
    expect(prompt).toContain("=== PERFIL Y ANCLA TEMPORAL ===");
    expect(prompt).toContain("HOY: 2026-07-22 (Mié).");
    expect(buildCoachSystemPrompt("g", "b", "t")).not.toContain("=== PERFIL Y ANCLA TEMPORAL ===");
  });
});

/**
 * Gotcha #18 → regla (d): cada builder de bloque exportado tiene su anuncio en
 * la instrucción, y la instrucción SOLO anuncia bloques presentes (criterio de
 * aceptación: sin bloques vacíos mentirosos).
 */
describe("buildCoachSystemPrompt — anuncios por bloque presente", () => {
  it("todo bloque presente aparece anunciado (modo planner, contexto completo)", () => {
    const prompt = buildCoachSystemPrompt(FULL_GARMIN, "bio", FULL_TRAINING, "planner", DETAIL);
    for (const a of BLOCK_ANNOUNCEMENTS) {
      expect(prompt).toContain(a.marker);
    }
  });

  it("ningún bloque ausente se anuncia", () => {
    const prompt = buildCoachSystemPrompt("Pasos: 10000", "bio", "Sin datos de entrenamiento.", "planner");
    for (const a of BLOCK_ANNOUNCEMENTS) {
      expect(prompt).not.toContain(a.marker);
    }
  });

  it("presencia y anuncio van bloque por bloque (no todo-o-nada)", () => {
    const garmin = "REGISTRO DIARIO COMPLETO (una línea por día, dato crudo del reloj):";
    const prompt = buildCoachSystemPrompt(garmin, "b", "t", "planner");
    expect(prompt).toContain("- DÍA A DÍA:");
    expect(prompt).not.toContain("- INTRADÍA:");
    expect(prompt).not.toContain("- ACTIVIDADES:");
  });

  it("la SEMANA solo se anuncia en los chats de entrenamiento", () => {
    const t = "HOY: 2026-07-22 — SEMANA EN CURSO: 23";
    expect(buildCoachSystemPrompt("g", "b", t, "planner")).toContain("- SEMANA: el bloque del plan activo");
    expect(buildCoachSystemPrompt("g", "b", t, "training")).toContain("- SEMANA: el bloque del plan activo");
    expect(buildCoachSystemPrompt("g", "b", t, "biohacking")).not.toContain("- SEMANA: el bloque del plan activo");
  });
});

describe("formatBiomarcadoresResults", () => {
  it("returns 'Sin resultados.' for empty input", () => {
    expect(formatBiomarcadoresResults([], "2026-01-01")).toBe("Sin resultados.");
  });

  it("groups by category, shows ref range, unit and flag marker", () => {
    const out = formatBiomarcadoresResults(
      [
        {
          category: "Perfil Lipidico",
          test_name: "Colesterol Total",
          result: 259,
          result_text: null,
          unit: "mg/dL",
          reference_min: 0,
          reference_max: 200,
          is_flagged: true,
        },
        {
          category: "Perfil Lipidico",
          test_name: "HDL",
          result: 55,
          result_text: null,
          unit: "mg/dL",
          reference_min: 40,
          reference_max: 100,
          is_flagged: false,
        },
      ],
      "2026-01-05"
    );
    expect(out).toContain("Fecha de muestra: 2026-01-05");
    expect(out).toContain("[Perfil Lipidico]");
    expect(out).toContain("Colesterol Total: 259 mg/dL (ref: 0-200) ⚠️");
    // Non-flagged row has no warning marker (`.` in the regex won't cross newlines)
    expect(out).toContain("HDL: 55 mg/dL (ref: 40-100)");
    expect(out).not.toMatch(/HDL:.*⚠️/);
  });

  it("uses result_text when numeric result is null", () => {
    const out = formatBiomarcadoresResults(
      [
        {
          category: "Examen de Orina",
          test_name: "Glucosa",
          result: null,
          result_text: "Negativo",
          unit: "",
          reference_min: null,
          reference_max: null,
          is_flagged: false,
        },
      ],
      "2026-01-05"
    );
    expect(out).toContain("Glucosa: Negativo");
  });

  it("falls back to '—' when both result and result_text are null, and omits ref when a bound is missing", () => {
    const out = formatBiomarcadoresResults(
      [
        {
          category: "Otros Marcadores",
          test_name: "Marcador X",
          result: null,
          result_text: null,
          unit: "u",
          reference_min: 10, // only one bound present -> ref must be omitted
          reference_max: null,
          is_flagged: false,
        },
      ],
      "2026-01-05"
    );
    expect(out).toContain("Marcador X: — u");
    expect(out).not.toContain("(ref:");
  });
});

describe("formatFlaggedHistory", () => {
  it("vacío → cadena vacía (el bloque se omite)", () => {
    expect(formatFlaggedHistory([])).toBe("");
  });

  it("lista cada alterado con fecha, categoría y referencia", () => {
    const out = formatFlaggedHistory([
      {
        sampleDate: "2026-01-05",
        category: "Perfil Lipidico",
        testName: "Colesterol Total",
        valueNum: 259,
        valueText: null,
        unit: "mg/dL",
        refLow: 0,
        refHigh: 200,
      },
      {
        sampleDate: null,
        category: "Orina",
        testName: "Glucosa",
        valueNum: null,
        valueText: "Positivo",
        unit: null,
        refLow: null,
        refHigh: null,
      },
    ]);
    expect(out).toContain("Alterados históricos");
    expect(out).toContain("2026-01-05 | [Perfil Lipidico] Colesterol Total: 259 mg/dL (ref: 0-200)");
    expect(out).toContain("s/fecha | [Orina] Glucosa: Positivo");
  });
});

describe("formatTrainingData", () => {
  const plan = {
    name: "Ultra 2026",
    goal_type: "ultra",
    goal_date: "2026-03-27",
    terrain: "trail",
    available_days: 5,
    llm_used: "claude",
    plan_json: {
      nutrition_flags: [
        { biomarker: "LDL", status: "high", recommendation: "reduce grasas saturadas" },
        { biomarker: "Glucosa", status: "normal", recommendation: "ok" },
      ],
    },
  };

  it("returns fallback text when there is no data", () => {
    expect(formatTrainingData(null, [], [], [])).toBe("Sin datos de entrenamiento.");
  });

  it("includes the active plan summary", () => {
    const out = formatTrainingData(plan, [], [], []);
    expect(out).toContain('Plan activo: "Ultra 2026"');
    expect(out).toContain("Objetivo: ultra - Fecha: 2026-03-27");
  });

  it("in biohacking mode shows only ABNORMAL nutrition flags (filters status 'normal')", () => {
    const out = formatTrainingData(plan, [], [], [], "biohacking");
    expect(out).toContain("Alertas nutricionales: LDL (high): reduce grasas saturadas");
    // 'normal' biomarkers must never leak in, even in biohacking mode
    expect(out).not.toContain("Glucosa");
  });

  it("in training mode EXCLUDES the entire nutrition-flags (clinical) block", () => {
    const out = formatTrainingData(plan, [], [], [], "training");
    expect(out).not.toContain("Alertas nutricionales");
    expect(out).not.toContain("LDL");
    expect(out).not.toContain("Glucosa");
  });

  it("computes plan compliance and actual-vs-planned km", () => {
    // Far-past dates so every row counts as 'past' regardless of today's date
    const planWorkouts = [
      { date: "2020-01-06", workout_type: "easy", status: "completed", target_distance_km: 10, actual_distance_km: 10 },
      { date: "2020-01-07", workout_type: "tempo", status: "planned", target_distance_km: 8, actual_distance_km: 0 },
      { date: "2020-01-08", workout_type: "rest", status: "planned", target_distance_km: 0, actual_distance_km: 0 },
    ];
    const out = formatTrainingData(null, planWorkouts, [], []);
    expect(out).toContain("Cumplimiento del plan: 1/2 entrenamientos (50%)");
    expect(out).toContain("Km planeados: 18.0 | Km reales: 10.0 (56%)");
  });

  it("lists manual workouts with exercise/set detail", () => {
    const manual = [
      {
        date: "2020-02-01",
        workout_type: "strength",
        title: "Full body",
        duration_minutes: 45,
        exercises: [{ name: "Sentadillas", sets: [{ reps: 10, weight: 60 }] }],
      },
    ];
    const out = formatTrainingData(null, [], manual, []);
    expect(out).toContain("Entrenamientos manuales recientes:");
    expect(out).toContain('2020-02-01: strength "Full body" - 1 ejercicios 45 min');
    expect(out).toContain("Sentadillas: 10x60kg");
  });

  it("lists running activities apart from the non-running ones", () => {
    const activities = [
      { date: "2026-01-10", activity_type: "running", distance_meters: 10000, duration_seconds: 3000, avg_hr: 150 },
      { date: "2026-01-09", activity_type: "cycling", distance_meters: 20000, duration_seconds: 3600 },
    ];
    const out = formatTrainingData(null, [], [], activities);
    expect(out).toContain("Carreras (todas");
    expect(out).toContain("2026-01-10: 10.0 km @ 5:00/km FC:150");
    // la bici no cuenta como carrera, pero tampoco se pierde
    expect(out).toMatch(/Otras actividades[\s\S]*cycling/);
  });
});

/**
 * Las carreras se listaban recortadas a 10 (de 90 días) y con solo 5 campos:
 * el resto del periodo y columnas con dato (nombre, calorías, elevación,
 * cadencia, training effect, VO2) nunca llegaban al chat. Las actividades que
 * no son carrera (caminatas, bici) se descartaban por completo.
 */
describe("formatTrainingData — actividades completas", () => {
  const manyRuns = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    activity_type: "running",
    distance_meters: 10000,
    duration_seconds: 3000,
  }));

  it("lista TODAS las carreras del periodo, no solo las 10 más recientes", () => {
    const out = formatTrainingData(null, [], [], manyRuns);
    const listed = out.match(/2026-01-\d\d: 10\.0 km/g) || [];
    expect(listed.length).toBe(25);
  });

  it("incluye el detalle por carrera que ya estaba en la DB", () => {
    const out = formatTrainingData(null, [], [], [
      {
        date: "2026-01-10",
        activity_type: "trail_running",
        activity_name: "Ajusco Trail",
        distance_meters: 21000,
        duration_seconds: 9000,
        avg_hr: 145,
        calories: 1499,
        elevation_gain: 316.09,
        elevation_loss: 300.5,
        avg_cadence: 151.2,
        training_effect: 3.7,
        vo2max_value: 46,
      },
    ]);
    expect(out).toContain("Ajusco Trail");
    expect(out).toContain("1499 kcal");
    expect(out).toContain("↑316");
    expect(out).toContain("↓301");
    expect(out).toContain("cad 151");
    expect(out).toContain("TE 3.7");
    expect(out).toContain("VO2 46");
  });

  it("resume las actividades que no son carrera en su propio bloque", () => {
    const out = formatTrainingData(null, [], [], [
      { date: "2026-01-08", activity_type: "walking", activity_name: "Caminata", distance_meters: 4120, duration_seconds: 3000 },
      { date: "2026-01-07", activity_type: "strength_training", duration_seconds: 2400, calories: 250 },
    ]);
    expect(out).toContain("Otras actividades");
    expect(out).toContain("walking");
    expect(out).toContain("4.1 km");
    expect(out).toContain("strength_training");
  });
});

describe("formatGarminSummary", () => {
  it("returns 'Sin datos.' when there are no summaries", () => {
    expect(formatGarminSummary([], [])).toBe("Sin datos.");
  });

  it("renders the latest-day snapshot (all metric lines) and the 7/30/90 averages header", () => {
    const summaries = [
      { date: "2026-01-01", steps: 8000, resting_hr: 50 },
      {
        date: "2026-01-02",
        steps: 10000,
        resting_hr: 48,
        avg_stress: 30,
        body_battery_high: 90,
        body_battery_low: 20,
        total_calories: 2500,
        active_calories: 800,
        avg_spo2: 96,
        hrv_weekly_avg: 65,
      },
    ];
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Último día (2026-01-02):");
    expect(out).toContain("Pasos: 10000");
    expect(out).toContain("FC Reposo: 48 bpm");
    expect(out).toContain("Body Battery: 90 → 20");
    expect(out).toContain("Calorías: 2500 (activas: 800)");
    expect(out).toContain("SpO2: 96%");
    expect(out).toContain("HRV: 65 ms");
    expect(out).toContain("Promedios 7/30/90 días");
  });

  it("converts sleep seconds to hours for the latest night and the average", () => {
    const summaries = [{ date: "2026-01-02", steps: 10000 }];
    const sleep = [{ date: "2026-01-02", sleep_seconds: 27000, sleep_score: 85 }];
    const out = formatGarminSummary(summaries, sleep);
    expect(out).toContain("Sueño último día: 7.5h (score: 85)");
    expect(out).toContain("Promedio sueño: 7.5h");
  });
});

/**
 * 2026-07-20: los chats de biohacking solo veían el snapshot del día + 4
 * promedios. Ahora deben ver la tendencia completa (hasta 90 días) de TODAS
 * las métricas: las 12 KPI del día + sueño, VO2 max (por actividad) y peso.
 */
describe("formatGarminSummary — tendencias de la ventana", () => {
  /** Genera `days` resúmenes terminando en endDate (YYYY-MM-DD, UTC). */
  function makeSummaries(
    days: number,
    endDate: string,
    valueFor: (daysAgo: number) => Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const end = new Date(`${endDate}T00:00:00Z`);
    const rows: Array<Record<string, unknown>> = [];
    for (let ago = days - 1; ago >= 0; ago--) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() - ago);
      rows.push({ date: d.toISOString().split("T")[0], ...valueFor(ago) });
    }
    return rows;
  }

  it("snapshot del último día incluye respiración, pisos e intensidad", () => {
    const summaries = [
      {
        date: "2026-07-20",
        steps: 9000,
        avg_respiration: 14.5,
        floors_climbed: 12,
        floors_descended: 10,
        moderate_intensity_min: 30,
        vigorous_intensity_min: 15,
      },
    ];
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Respiración: 14.5 rpm");
    expect(out).toContain("Pisos: 12 subidos / 10 bajados");
    expect(out).toContain("Intensidad: 45 min (moderada 30 + vigorosa 15)");
  });

  it("promedios 7/30/90 días por métrica, relativos al último día con datos", () => {
    // steps: últimos 7 días = 10000, días 8-30 = 8000, días 31-90 = 5000
    const summaries = makeSummaries(90, "2026-07-20", (ago) => ({
      steps: ago < 7 ? 10000 : ago < 30 ? 8000 : 5000,
    }));
    const out = formatGarminSummary(summaries, []);
    // 7d = 10000 | 30d = (7*10000 + 23*8000)/30 = 8467 | 90d = 6156
    expect(out).toContain("Pasos: 10000 / 8467 / 6156");
  });

  it("los promedios por rango cubren todas las métricas KPI con datos", () => {
    const summaries = makeSummaries(90, "2026-07-20", () => ({
      steps: 9000,
      resting_hr: 48,
      avg_stress: 30,
      body_battery_high: 90,
      body_battery_low: 20,
      total_calories: 2500,
      active_calories: 800,
      avg_spo2: 96,
      avg_respiration: 14.5,
      hrv_weekly_avg: 65,
      floors_climbed: 12,
      moderate_intensity_min: 30,
      vigorous_intensity_min: 15,
    }));
    const sleep = makeSummaries(90, "2026-07-20", () => ({
      sleep_seconds: 27000,
      sleep_score: 85,
    }));
    const out = formatGarminSummary(summaries, sleep);
    expect(out).toContain("FC Reposo (bpm): 48 / 48 / 48");
    expect(out).toContain("Estrés: 30 / 30 / 30");
    expect(out).toContain("Body Battery máx: 90 / 90 / 90");
    expect(out).toContain("Body Battery mín: 20 / 20 / 20");
    expect(out).toContain("Calorías totales: 2500 / 2500 / 2500");
    expect(out).toContain("Calorías activas: 800 / 800 / 800");
    expect(out).toContain("SpO2 (%): 96.0 / 96.0 / 96.0");
    expect(out).toContain("Respiración (rpm): 14.5 / 14.5 / 14.5");
    expect(out).toContain("HRV (ms): 65 / 65 / 65");
    expect(out).toContain("Pisos subidos: 12 / 12 / 12");
    expect(out).toContain("Intensidad (min/día): 45 / 45 / 45");
    expect(out).toContain("Sueño (h): 7.5 / 7.5 / 7.5");
    expect(out).toContain("Sueño score: 85 / 85 / 85");
  });

  it("tendencia semanal: agrupa por semana (lunes) y promedia", () => {
    // 2024-01-01 fue lunes: dos días de esa semana + un día de la siguiente
    const summaries = [
      { date: "2024-01-01", steps: 1000 },
      { date: "2024-01-02", steps: 2000 },
      { date: "2024-01-08", steps: 3000 },
    ];
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Tendencia semanal");
    expect(out).toMatch(/2024-01-01: Pasos 1500/);
    expect(out).toMatch(/2024-01-08: Pasos 3000/);
  });

  it("incluye la tendencia de VO2 max derivada de actividades", () => {
    const activities = [
      { date: "2026-05-10", vo2max_value: 51.2 },
      { date: "2026-06-01", vo2max_value: 52 },
      { date: "2026-06-01", vo2max_value: null }, // sin dato, no pisa el anterior
    ];
    const out = formatGarminSummary(
      [{ date: "2026-06-02", steps: 100 }],
      [],
      [],
      activities
    );
    expect(out).toContain("VO2 max (por actividad):");
    expect(out).toContain("2026-05-10: 51.2");
    expect(out).toContain("2026-06-01: 52");
  });

  it("incluye el historial completo de peso en kg", () => {
    const weightHistory = [
      { date: "2026-01-15", weightKg: 82 },
      { date: "2026-07-15", weightKg: 80.4 },
    ];
    const out = formatGarminSummary(
      [{ date: "2026-07-20", steps: 100 }],
      [],
      weightHistory
    );
    expect(out).toContain("Peso (historial completo, kg):");
    expect(out).toContain("2026-01-15: 82.0");
    expect(out).toContain("2026-07-15: 80.4");
    // Snapshot: última medición conocida
    expect(out).toContain("Peso: 80.4 kg (2026-07-15)");
  });

  it("snapshot incluye el último VO2 max conocido", () => {
    const out = formatGarminSummary(
      [{ date: "2026-07-20", steps: 100 }],
      [],
      [],
      [{ date: "2026-07-18", vo2max_value: 52.5 }]
    );
    expect(out).toContain("VO2 max: 52.5 (2026-07-18)");
  });

  it("omite las secciones de VO2 max y peso cuando no hay datos", () => {
    const out = formatGarminSummary([{ date: "2026-07-20", steps: 100 }], []);
    expect(out).not.toContain("VO2 max");
    expect(out).not.toContain("Peso");
  });
});

/**
 * El coach debe interpretar el valor de HOY contra el baseline personal
 * (promedio de los días previos), calificado según la dirección sana de cada
 * métrica (FC reposo/estrés: bajar es mejor; HRV/pasos/sueño: subir es mejor).
 */
describe("formatGarminSummary — hoy vs. baseline personal", () => {
  function makeSummaries(
    days: number,
    endDate: string,
    valueFor: (daysAgo: number) => Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const end = new Date(`${endDate}T00:00:00Z`);
    const rows: Array<Record<string, unknown>> = [];
    for (let ago = days - 1; ago >= 0; ago--) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() - ago);
      rows.push({ date: d.toISOString().split("T")[0], ...valueFor(ago) });
    }
    return rows;
  }

  it("compara hoy contra el baseline y califica según la dirección de la métrica", () => {
    const summaries = makeSummaries(8, "2026-07-20", (ago) => ({
      resting_hr: ago === 0 ? 60 : 50, // FC subió: peor (bajar es mejor)
      hrv_weekly_avg: ago === 0 ? 70 : 65, // HRV subió: mejor
      avg_stress: ago === 0 ? 60 : 30, // estrés subió: peor
    }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Hoy vs. baseline personal");
    expect(out).toContain(
      "FC Reposo (bpm): hoy 60 | baseline 50 | +20.0% (peor que su baseline; tendencia: estable)"
    );
    expect(out).toContain(
      "HRV (ms): hoy 70 | baseline 65 | +7.7% (mejor que su baseline; tendencia: estable)"
    );
    expect(out).toContain(
      "Estrés: hoy 60 | baseline 30 | +100.0% (peor que su baseline; tendencia: estable)"
    );
  });

  it("marca 'en su baseline' cuando la desviación es menor a 5%", () => {
    const summaries = makeSummaries(8, "2026-07-20", (ago) => ({
      resting_hr: ago === 0 ? 51 : 50, // +2%: dentro del baseline
    }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("FC Reposo (bpm): hoy 51 | baseline 50 | +2.0% (en su baseline");
  });

  it("detecta la tendencia reciente (7d vs 90d) como mejorando/empeorando", () => {
    // Pasos: última semana 10000, resto 5000 → tendencia al alza = mejorando
    const summaries = makeSummaries(90, "2026-07-20", (ago) => ({
      steps: ago < 7 ? 10000 : 5000,
    }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toMatch(/Pasos: hoy 10000 .*mejor que su baseline; tendencia: mejorando/);
  });

  it("las métricas neutras (calorías totales) no se califican como mejor/peor", () => {
    const summaries = makeSummaries(8, "2026-07-20", (ago) => ({
      total_calories: ago === 0 ? 3000 : 2500,
    }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Calorías totales: hoy 3000 | baseline 2500 | +20.0% (tendencia: estable)");
    expect(out).not.toMatch(/Calorías totales:.*(mejor|peor) que su baseline/);
  });

  it("incluye el sueño en la comparación contra baseline", () => {
    const summaries = makeSummaries(8, "2026-07-20", () => ({ steps: 100 }));
    const sleep = makeSummaries(8, "2026-07-20", (ago) => ({
      sleep_seconds: ago === 0 ? 21600 : 27000, // hoy 6h vs baseline 7.5h: peor
    }));
    const out = formatGarminSummary(summaries, sleep);
    expect(out).toContain("Sueño (h): hoy 6.0 | baseline 7.5 | -20.0% (peor que su baseline");
  });

  it("omite el bloque cuando solo hay un día de datos (no hay baseline)", () => {
    const out = formatGarminSummary([{ date: "2026-07-20", steps: 100 }], []);
    expect(out).not.toContain("Hoy vs. baseline personal");
  });
});

describe("buildCoachSystemPrompt — interpretación por tendencia personal", () => {
  it.each<CoachMode>(["biohacking", "training", "planner"])(
    "el modo %s instruye a evaluar contra el baseline personal, no rangos poblacionales",
    (mode) => {
      const prompt = buildCoachSystemPrompt("datos", "bio", "training", mode);
      expect(prompt).toContain(`baseline de ${HEALTH_WINDOW_DAYS} días`);
      expect(prompt).toContain("puede ser bueno para una persona y malo para otra");
      expect(prompt).toContain("rangos poblacionales");
    }
  );
});

describe("buildCoachSystemPrompt — ventana de datos", () => {
  it.each<CoachMode>(["biohacking", "training", "planner"])(
    "el modo %s anuncia la ventana real de datos Garmin",
    (mode) => {
      const prompt = buildCoachSystemPrompt("datos", "bio", "training", mode);
      // El encabezado debe declarar EXACTAMENTE la ventana vigente, leída del
      // propio prompt en vez de un literal.
      const header = prompt.match(/=== DATOS DE GARMIN \(últimos (\d+) días\) ===/);
      expect(header).not.toBeNull();
      expect(Number(header![1])).toBe(HEALTH_WINDOW_DAYS);
    }
  );
});

/**
 * Los chats deben ver estadísticas completas: percentiles, picos con fecha y
 * desviación estándar, por ventana 7/30/90, por métrica y para las carreras.
 */
describe("formatGarminSummary — estadísticas completas por métrica", () => {
  function makeSummaries(
    days: number,
    endDate: string,
    valueFor: (daysAgo: number) => Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const end = new Date(`${endDate}T00:00:00Z`);
    const rows: Array<Record<string, unknown>> = [];
    for (let ago = days - 1; ago >= 0; ago--) {
      const d = new Date(end);
      d.setUTCDate(end.getUTCDate() - ago);
      rows.push({ date: d.toISOString().split("T")[0], ...valueFor(ago) });
    }
    return rows;
  }

  it("emite el bloque con ventanas 7/30/90 por métrica (dataset constante)", () => {
    const summaries = makeSummaries(90, "2026-07-20", () => ({ steps: 9000, resting_hr: 48 }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain(
      "Estadísticas completas por métrica (ventanas 7/30/90 días hasta 2026-07-20):"
    );
    // Constante: percentiles colapsan, σ=0, y el empate de picos da la fecha más reciente
    expect(out).toContain(
      "    7d: media 9000 | p50 9000 | p25–p75 9000–9000 | p10–p90 9000–9000 | mín 9000 (2026-07-20) | máx 9000 (2026-07-20) | σ 0 | n 7"
    );
    expect(out).toMatch(/90d: media 9000 .*σ 0 \| n 90/);
  });

  it("calcula percentiles y picos reales en la ventana de 7 días", () => {
    // Últimos 7 días: 1000 (hoy) … 7000 (hace 6); resto 8000
    const summaries = makeSummaries(90, "2026-07-20", (ago) => ({
      steps: ago < 7 ? 1000 * (ago + 1) : 8000,
    }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain(
      "    7d: media 4000 | p50 4000 | p25–p75 2500–5500 | p10–p90 1600–6400 | mín 1000 (2026-07-20) | máx 7000 (2026-07-14) | σ 2000 | n 7"
    );
  });

  it("incluye el sueño con unidad h", () => {
    const summaries = makeSummaries(7, "2026-07-20", () => ({ steps: 100 }));
    const sleep = makeSummaries(7, "2026-07-20", () => ({ sleep_seconds: 27000 }));
    const out = formatGarminSummary(summaries, sleep);
    expect(out).toMatch(/Sueño \(h\):\n\s+7d: media 7\.5h \| p50 7\.5h/);
  });

  it("omite métricas sin ningún dato del bloque de estadísticas", () => {
    const summaries = makeSummaries(7, "2026-07-20", () => ({ steps: 100 }));
    const out = formatGarminSummary(summaries, []);
    expect(out).toContain("Estadísticas completas por métrica");
    expect(out).not.toContain("HRV (ms)");
    expect(out).not.toContain("Sueño score");
  });
});

describe("formatTrainingData — estadísticas de carrera (ventana de datos)", () => {
  const activities = [
    { date: "2026-07-10", activity_type: "running", distance_meters: 4000, duration_seconds: 1440 },
    { date: "2026-07-08", activity_type: "running", distance_meters: 10000, duration_seconds: 2700, avg_hr: 160 },
    { date: "2026-07-03", activity_type: "running", distance_meters: 20000, duration_seconds: 7200, avg_hr: 150 },
    { date: "2026-07-01", activity_type: "running", distance_meters: 10000, duration_seconds: 3000 },
    { date: "2026-07-02", activity_type: "cycling", distance_meters: 50000, duration_seconds: 5400 },
  ];

  it("resume número de carreras y km totales", () => {
    const out = formatTrainingData(null, [], [], activities);
    expect(out).toContain(`Estadísticas de carrera (últimos ${HEALTH_WINDOW_DAYS} días):`);
    expect(out).toContain("Carreras: 4 | Km totales: 44.0");
  });

  it("distribución de distancias con percentiles y picos con fecha", () => {
    const out = formatTrainingData(null, [], [], activities);
    expect(out).toContain(
      "Distancia por carrera (km): media 11.0 | p50 10.0 | p25–p75 8.5–12.5 | p10–p90 5.8–17.0 | mín 4.0 (2026-07-10) | máx 20.0 (2026-07-03) | σ 5.7 | n 4"
    );
  });

  it("distribución de ritmos con mejor/peor con fecha (empate → más reciente)", () => {
    const out = formatTrainingData(null, [], [], activities);
    expect(out).toContain("Ritmo (min/km): media 5:23 | p50 5:30");
    expect(out).toContain("mejor 4:30 (2026-07-08)");
    // 6:00 empatado el 07-03 y el 07-10: gana la fecha más reciente
    expect(out).toContain("peor 6:00 (2026-07-10)");
  });

  it("distribución de FC promedio solo sobre carreras con dato", () => {
    const out = formatTrainingData(null, [], [], activities);
    expect(out).toContain(
      "FC promedio (bpm): media 155 | p50 155 | p25–p75 153–158 | p10–p90 151–159 | mín 150 (2026-07-03) | máx 160 (2026-07-08) | σ 5 | n 2"
    );
  });

  it("distribución del volumen semanal (semanas lunes-domingo)", () => {
    const out = formatTrainingData(null, [], [], activities);
    // Semana del 2026-06-29: 10+20 = 30 km | semana del 2026-07-06: 10+4 = 14 km
    expect(out).toContain("Volumen semanal (km): media 22.0 | p50 22.0");
    expect(out).toContain("mín 14.0 (semana del 2026-07-06)");
    expect(out).toContain("máx 30.0 (semana del 2026-06-29)");
  });

  it("omite el bloque cuando no hay carreras", () => {
    const out = formatTrainingData(null, [], [], []);
    expect(out).not.toContain("Estadísticas de carrera");
  });
});

/**
 * Cada carrera se clasifica por FC (lib/training/run-intensity) usando las
 * zonas del plan activo cuando existen, y el bloque "Por intensidad" resume
 * n/km/ritmo/FC por categoría.
 */
describe("formatTrainingData — clasificación HIIT/tempo/Z2 por FC", () => {
  const zones = [
    { zone: "Z1", bpm_range: [100, 130] },
    { zone: "Z2", bpm_range: [131, 145] },
    { zone: "Z3", bpm_range: [146, 160] },
    { zone: "Z4", bpm_range: [161, 175] },
    { zone: "Z5", bpm_range: [176, 190] },
  ];
  const planWithZones = {
    name: "Ultra",
    goal_type: "ultra",
    goal_date: "2026-10-09",
    terrain: "trail",
    available_days: 7,
    llm_used: "claude",
    plan_json: { hr_zones: zones },
  };
  const activities = [
    // spread 35 y pico al 100% del máx personal → HIIT
    { date: "2026-07-10", activity_type: "running", distance_meters: 8000, duration_seconds: 2400, avg_hr: 150, max_hr: 185 },
    // avg 140 en Z2 del plan → Z2
    { date: "2026-07-08", activity_type: "running", distance_meters: 10000, duration_seconds: 3600, avg_hr: 140, max_hr: 150 },
    // avg 155 en Z3 del plan → tempo
    { date: "2026-07-06", activity_type: "running", distance_meters: 12000, duration_seconds: 3600, avg_hr: 155, max_hr: 165 },
    // sin FC
    { date: "2026-07-04", activity_type: "running", distance_meters: 5000, duration_seconds: 1500 },
  ];

  it("etiqueta cada carrera listada con su intensidad, FC máx y la zona del pico", () => {
    const out = formatTrainingData(planWithZones, [], [], activities);
    expect(out).toContain("2026-07-10: 8.0 km @ 5:00/km FC:150 máx:185 (Z5) [HIIT]");
    expect(out).toContain("2026-07-08: 10.0 km @ 6:00/km FC:140 máx:150 (Z3) [Z2]");
    expect(out).toContain("2026-07-06: 12.0 km @ 5:00/km FC:155 máx:165 (Z4) [tempo]");
    expect(out).toContain("2026-07-04: 5.0 km @ 5:00/km [s/FC]");
  });

  it("incluye el ritmo de sprint (max_speed) cuando existe", () => {
    const acts = [
      {
        date: "2026-07-21",
        activity_type: "running",
        distance_meters: 7441,
        duration_seconds: 3717,
        avg_hr: 130,
        max_hr: 168,
        max_speed: 3.126, // m/s → 319.9 s/km → 5:20/km
      },
    ];
    const out = formatTrainingData(planWithZones, [], [], acts);
    expect(out).toContain("máx:168 (Z4) sprint 5:20/km");
  });

  it("agrega la curva de FC intradía de los días con carrera cuando hay muestras", () => {
    const base = Date.parse("2026-07-21T13:00:00Z"); // 07:00 CDMX
    const at = (min: number, hr: number) => ({ timestamp_ms: base + min * 60_000, heart_rate: hr });
    const samples = [at(0, 95), at(2, 120), at(4, 140), at(6, 150), at(8, 165), at(10, 150), at(12, 120), at(14, 95)];
    const out = formatTrainingData(planWithZones, [], [], activities, "biohacking", {
      "2026-07-21": samples,
    });
    expect(out).toContain("Curva FC intradía");
    expect(out).toContain("2026-07-21 | ventana elevada 07:02–07:12 | máx muestra 165 (07:08)");
    // Cortes personalizados desde las zonas del plan: >145 (techo Z2) y ≥161 (piso Z4)
    expect(out).toContain("~6 min >145 bpm");
    expect(out).toContain("~2 min ≥161 bpm");
    expect(out).toContain("curva: 07:02 120 · 07:04 140");
  });

  it("omite el bloque de curva sin muestras", () => {
    const out = formatTrainingData(planWithZones, [], [], activities);
    expect(out).not.toContain("Curva FC intradía");
  });

  it("agrega el desglose 'Por intensidad' con n, km, ritmo, FC y spread", () => {
    const out = formatTrainingData(planWithZones, [], [], activities);
    expect(out).toContain("Por intensidad (clasificación por FC):");
    expect(out).toContain("HIIT: n=1 | 8.0 km | ritmo media 5:00 (mejor 5:00) | FC prom media 150 | spread FC medio 35");
    expect(out).toContain("tempo: n=1 | 12.0 km | ritmo media 5:00");
    expect(out).toContain("Z2: n=1 | 10.0 km | ritmo media 6:00");
    expect(out).toContain("s/FC: n=1 | 5.0 km");
  });

  it("clasifica sin plan activo usando el máx personal de FC", () => {
    const noPlanActs = [
      { date: "2026-07-10", activity_type: "running", distance_meters: 8000, duration_seconds: 2400, avg_hr: 150, max_hr: 185 },
      // 135/185 = 73% del máx personal → Z2
      { date: "2026-07-08", activity_type: "running", distance_meters: 10000, duration_seconds: 3600, avg_hr: 135, max_hr: 150 },
    ];
    const out = formatTrainingData(null, [], [], noPlanActs);
    expect(out).toContain("[HIIT]");
    expect(out).toContain("[Z2]");
  });
});

describe("buildCoachSystemPrompt — instrucción de intensidad HIIT/Z2", () => {
  it.each<CoachMode>(["biohacking", "training", "planner"])(
    "el modo %s instruye a usar la clasificación de intensidad y el 80/20 (bloque presente)",
    (mode) => {
      const prompt = buildCoachSystemPrompt("datos", "bio", FULL_TRAINING, mode);
      expect(prompt).toContain("[HIIT]");
      expect(prompt).toContain("Por intensidad");
      expect(prompt).toContain("80/20");
    }
  );
});

describe("buildCoachSystemPrompt — instrucción intra-carrera (regresión chat Jorge)", () => {
  it.each<CoachMode>(["biohacking", "training", "planner"])(
    "el modo %s prohíbe negar acceso a los picos y explica qué detalle sí hay",
    (mode) => {
      const prompt = buildCoachSystemPrompt("datos", "bio", FULL_TRAINING, mode, DETAIL);
      expect(prompt).toContain("pico REAL de FC");
      expect(prompt).toContain("curva de FC intradía");
      expect(prompt).toContain("NUNCA digas que no tienes acceso");
      // Ahora SÍ tiene laps de los últimos 15 días (bloque DETALLE DE ACTIVIDADES)
      expect(prompt).toContain("laps");
      expect(prompt).toContain("últimos 15 días");
    }
  );
});

describe("buildCoachSystemPrompt — instrucción de estadísticas completas", () => {
  it.each<CoachMode>(["biohacking", "training", "planner"])(
    "el modo %s instruye a usar percentiles, picos y desviación estándar (bloque presente)",
    (mode) => {
      const prompt = buildCoachSystemPrompt(FULL_GARMIN, "bio", "training", mode);
      expect(prompt).toContain("Estadísticas completas por métrica");
      expect(prompt).toContain("percentiles");
      expect(prompt).toContain("p90");
    }
  );
});

/**
 * Regression (original): pace per km was formatted by rounding the seconds
 * component independently, so 5.9983 min/km rendered "5:60/km" instead of
 * carrying over to "6:00/km".
 */
describe("formatTrainingData — pace seconds carry (regression)", () => {
  it("never emits a ':60' seconds value in a pace", () => {
    const out = formatTrainingData(
      null,
      [],
      [],
      [{ date: "2026-07-15", activity_type: "running", distance_meters: 10000, duration_seconds: 3599 }],
      "biohacking"
    );
    expect(out).not.toContain(":60/km");
    expect(out).toContain("6:00/km");
  });

  it("formats an exact pace correctly", () => {
    const out = formatTrainingData(
      null,
      [],
      [],
      [{ date: "2026-07-15", activity_type: "running", distance_meters: 10000, duration_seconds: 3000 }],
      "biohacking"
    );
    expect(out).toContain("5:00/km");
  });
});

// ---------------------------------------------------------------------------
// Fuerza y ancla de semana en el contexto de los 3 chats
// ---------------------------------------------------------------------------

/** Hoy fijo para los tests de ancla: miércoles 2026-07-22 (lunes = 2026-07-20). */
const FIXED_TODAY = "2026-07-22";
const FIXED_MONDAY = "2026-07-20";

function shift(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Plan cuyas semanas 22 y 23 rodean el "hoy" fijo (la 23 es la actual). */
function planAroundFixedToday() {
  const mkWeek = (weekNumber: number, start: string) => ({
    weekNumber,
    phase: "build",
    weekStartDate: start,
    totalKm: 70,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: shift(start, i),
      dayOfWeek: i,
      dayLabel: "X",
      sessionType: "z2",
      distanceKm: 10,
      zone: "Z2",
      notes: "",
      isKeySession: false,
    })),
  });
  return {
    name: "Ultra 2026",
    goal_type: "ultra",
    goal_date: "2026-10-09",
    terrain: "trail",
    available_days: 5,
    llm_used: "claude",
    plan_json: {
      weeks: [mkWeek(22, shift(FIXED_MONDAY, -7)), mkWeek(23, FIXED_MONDAY)],
    },
  };
}

describe("formatTrainingData — ancla de semana en curso", () => {
  it("dice qué día es hoy y en qué semana del plan va el usuario", () => {
    const out = formatTrainingData(planAroundFixedToday(), [], [], [], "biohacking", undefined, undefined, FIXED_TODAY);
    expect(out).toContain("SEMANA EN CURSO: 23");
    expect(out).toContain(FIXED_TODAY);
  });

  it("no inventa el ancla cuando el plan no trae semanas", () => {
    const out = formatTrainingData(
      { name: "X", goal_type: "ultra", goal_date: "2026-10-09", terrain: "trail", available_days: 5, llm_used: "claude", plan_json: {} },
      [],
      [],
      [],
      "biohacking",
      undefined,
      undefined,
      FIXED_TODAY
    );
    expect(out).not.toContain("SEMANA EN CURSO");
  });

  it("el ancla es determinística por día: mismo today → mismo texto", () => {
    const plan = planAroundFixedToday();
    const a = formatTrainingData(plan, [], [], [], "planner", undefined, undefined, FIXED_TODAY);
    const b = formatTrainingData(plan, [], [], [], "planner", undefined, undefined, FIXED_TODAY);
    expect(b).toBe(a);
  });
});

describe("formatTrainingData — fuerza registrada", () => {
  const strength = "Semana en curso (desde 2026-08-03):\n  2026-08-03 (Lun): Press de banca 3 series — 60×10";

  it("cuelga el bloque de fuerza cuando hay registro", () => {
    const out = formatTrainingData(null, [], [], [], "training", undefined, strength);
    expect(out).toContain("FUERZA REGISTRADA");
    expect(out).toContain("Press de banca 3 series");
  });

  it("llega al prompt en los tres modos", () => {
    for (const mode of ["training", "planner", "biohacking"] as CoachMode[]) {
      const training = formatTrainingData(null, [], [], [], mode, undefined, strength);
      const prompt = buildCoachSystemPrompt("", "", training, mode);
      expect(prompt).toContain("Press de banca 3 series");
    }
  });

  it("sin fuerza registrada no agrega la sección", () => {
    const out = formatTrainingData(null, [], [], [], "training");
    expect(out).not.toContain("FUERZA REGISTRADA");
  });
});

describe("buildCoachSystemPrompt — instrucciones de fuerza y semana", () => {
  it("le dice a los chats de entrenamiento que SÍ tienen el detalle de fuerza", () => {
    for (const mode of ["training", "planner"] as CoachMode[]) {
      const prompt = buildCoachSystemPrompt("", "", FULL_TRAINING, mode);
      expect(prompt).toMatch(/FUERZA REGISTRADA/);
      expect(prompt).toMatch(/nunca digas que no tienes/i);
    }
  });

  it("le dice al chat Planes que sin semana explícita se habla de la semana en curso", () => {
    const prompt = buildCoachSystemPrompt("", "", "datos", "planner");
    expect(prompt).toMatch(/semana en curso/i);
  });
});

/**
 * Los bloques crudos no sirven si el prompt no le dice al LLM que existen:
 * seguía contestando "no tengo ese dato" con el dato en el contexto.
 */
describe("buildCoachSystemPrompt — instrucción de los datos crudos", () => {
  it("los 3 modos anuncian el registro diario, los pasos y las actividades presentes", () => {
    for (const mode of ["biohacking", "training", "planner"] as CoachMode[]) {
      const prompt = buildCoachSystemPrompt(FULL_GARMIN, "b", FULL_TRAINING, mode);
      expect(prompt).toContain("REGISTRO DIARIO COMPLETO");
      expect(prompt).toContain("PASOS");
      expect(prompt).toContain("meta semanal");
      expect(prompt).toMatch(/todas las carreras/i);
    }
  });

  it("todos los modos anuncian la composición corporal cuando está presente", () => {
    for (const mode of ["biohacking", "training", "planner"] as CoachMode[]) {
      expect(buildCoachSystemPrompt(FULL_GARMIN, "b", "t", mode)).toContain("COMPOSICIÓN CORPORAL");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Perfil, edad y helpers de tz                                        */
/* ------------------------------------------------------------------ */

describe("formatProfileBlock", () => {
  it("arma perfil + ancla HOY sin nombres personales", () => {
    const out = formatProfileBlock({
      age: 34,
      sex: "M",
      maxHr: 190,
      timezone: "America/Mexico_City",
      providers: ["garmin", "oura"],
      stepsGoal: { min: 150000, max: 200000 },
      planName: "Ultra 2026",
      today: "2026-07-22",
    });
    expect(out).toContain("Edad: 34 | Sexo: M | FC máx: 190");
    expect(out).toContain("Zona horaria: America/Mexico_City | Proveedores conectados: garmin, oura");
    expect(out).toContain("Meta de pasos semanal: 150,000–200,000");
    expect(out).toContain('Plan activo: "Ultra 2026"');
    expect(out).toContain("HOY: 2026-07-22 (Mié).");
  });

  it("omite lo que no hay (sin edad/plan/proveedores) pero siempre ancla HOY", () => {
    const out = formatProfileBlock({ timezone: "UTC", today: "2026-07-20" });
    expect(out).not.toContain("Edad:");
    expect(out).not.toContain("Plan activo");
    expect(out).toContain("Zona horaria: UTC");
    expect(out).toContain("HOY: 2026-07-20 (Lun).");
  });
});

describe("computeAge", () => {
  it("años completos, con y sin cumpleaños pasado", () => {
    expect(computeAge("1992-03-10", "2026-07-22")).toBe(34);
    expect(computeAge("1992-09-10", "2026-07-22")).toBe(33);
    expect(computeAge("1992-07-22", "2026-07-22")).toBe(34);
  });

  it("null para fechas inválidas o ausentes", () => {
    expect(computeAge(null, "2026-07-22")).toBeNull();
    expect(computeAge("no-fecha", "2026-07-22")).toBeNull();
    expect(computeAge("2030-01-01", "2026-07-22")).toBeNull();
  });
});

describe("tz helpers — todayInTz/dateInTz (sin zonas hardcodeadas)", () => {
  it("la fecha calendario depende de la tz del usuario", () => {
    const at = new Date("2026-01-01T23:30:00Z");
    expect(dateInTz(at, "UTC")).toBe("2026-01-01");
    expect(dateInTz(at, "Asia/Tokyo")).toBe("2026-01-02");
    expect(dateInTz(at, "America/Mexico_City")).toBe("2026-01-01");
    expect(todayInTz("Asia/Tokyo", at)).toBe("2026-01-02");
  });

  it("una tz corrupta cae a UTC en vez de tirar el chat", () => {
    expect(dateInTz(new Date("2026-01-01T12:00:00Z"), "No/Existe")).toBe("2026-01-01");
  });

  it("daysBefore hace aritmética de calendario", () => {
    expect(daysBefore("2026-09-01", 45)).toBe("2026-07-18");
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
  });
});
