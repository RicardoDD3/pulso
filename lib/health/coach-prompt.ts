/**
 * Builders PUROS del system prompt del coach (port de
 * lib/biomarcadores/coach-prompt.ts de el-consejo — el corazón del producto).
 *
 * Cambios del port (spec doc 08):
 * - "Hoy" es un parámetro (`today`, YYYY-MM-DD en la tz del usuario) — nada de
 *   relojes ni zonas hardcodeadas dentro de los builders: el prompt es
 *   determinístico por (usuario, feature, día).
 * - Las instrucciones que ANUNCIAN bloques crudos (gotcha #18 del original)
 *   ahora se emiten SOLO cuando su bloque está presente en el contexto: la
 *   instrucción nunca promete un bloque que no viaja (criterio de aceptación
 *   "sin bloques vacíos mentirosos"). El mapeo builder→anuncio vive en
 *   BLOCK_ANNOUNCEMENTS y tiene test propio.
 * - El idioma de respuesta se instruye al final con el locale del perfil
 *   ("Responde en el idioma del usuario: …") en vez del "Responde en español"
 *   fijo del original. Los encabezados de bloque siguen en español: son parte
 *   del contrato testeado.
 */
import { extractVo2maxTrend } from "@/lib/health/vo2max";
import {
  computeStats,
  computeStatsWithDates,
  formatStatsLine,
  formatMinSec,
} from "@/lib/health/stats";
import {
  classifyRun,
  personalHrMax,
  peakZoneLabel,
  intensityCuts,
  INTENSITY_LABEL,
  type RunIntensity,
  type RunIntensityContext,
} from "@/lib/training/run-intensity";
import { formatHrCurveDay, type HrSample } from "@/lib/health/hr-intraday";
import { formatWeekAnchor, weekdayLabel } from "@/lib/training/plan-week";
import {
  HEALTH_WINDOW_DAYS,
  TREND_WINDOWS,
  TREND_WINDOWS_LABEL,
} from "@/lib/health/health-window";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";
import type { HrZone } from "@/lib/training/types";

export type CoachMode = "biohacking" | "training" | "planner";

/* ------------------------------------------------------------------ */
/* Instrucciones que anuncian los bloques crudos                       */
/* ------------------------------------------------------------------ */

const LINE_STRENGTH = `- FUERZA: tienes el bloque "FUERZA REGISTRADA" con la fuerza real del usuario — cada serie de pesas (peso × reps, por día), las reps de peso corporal, el tonelaje y las sesiones por semana, sus récords de peso por ejercicio y su avance contra la meta semanal. Úsalo al evaluar su semana y al hablar de fuerza; nunca digas que no tienes esos datos ni des la fuerza por no hecha sin revisarlo. La fuerza del PLAN es un flag por día (día de fuerza), independiente de la corrida.`;
const LINE_WEEK = `- SEMANA: el bloque del plan activo trae "HOY" y la "SEMANA EN CURSO". Cuando el usuario hable de "la semana" o de un día suelto ("el miércoles") sin decir cuál, se refiere SIEMPRE a la semana en curso, no a la semana 1 del plan.`;

const LINE_DAILY = `- DÍA A DÍA: el bloque "REGISTRO DIARIO COMPLETO" trae una línea por día (${HEALTH_WINDOW_DAYS} días) con el dato crudo del reloj: pasos, distancia total, calorías, FC en reposo/mín/máx, estrés, Body Battery, respiración, HRV y su estado, pisos, minutos de intensidad y el sueño de esa noche (total, score, fases profundo/ligero/REM/despierto y horario). Úsalo para responder por un día concreto ("¿cuántos pasos di el martes?", "¿cómo dormí el 3?") en vez de contestar con promedios.`;
const LINE_STEPS = `- PASOS: el bloque "PASOS" trae la meta semanal REAL del usuario (la que él configuró), la meta diaria derivada, el total y promedio del periodo, los días que alcanzaron la meta y el acumulado de CADA semana contra la meta. La semana marcada "en curso" va incompleta: no la juzgues como semana fallada.`;
const LINE_ACTIVITIES = `- ACTIVIDADES: el bloque de carreras lista TODAS las carreras del periodo (no solo las recientes) con km, ritmo, FC prom/máx, sprint, intensidad, nombre, calorías, desnivel, cadencia, training effect y VO2. Las que no son carrera (caminatas, bici, fuerza del reloj) van en "Otras actividades". Si preguntan por una carrera concreta, búscala ahí antes de decir que no la tienes.`;
const LINE_INTRADAY = `- INTRADÍA: el bloque "BODY BATTERY Y ESTRÉS INTRADÍA" resume los últimos 7 días (nivel al despertar, pico y mínimo con hora, mayor caída sostenida y minutos en estrés alto): úsalo para explicar por qué se drenó un día concreto.`;
const LINE_COMPOSITION = `- COMPOSICIÓN CORPORAL: el bloque con ese nombre trae cada medición de báscula (peso, IMC, % de grasa, músculo, agua y hueso). Correlaciónala con laboratorio y carga de entrenamiento; no digas que solo tienes el peso.`;

const LINE_STATS = `- Apóyate en el bloque "Estadísticas completas por métrica" (percentiles, picos con fecha y desviación estándar por ventana ${TREND_WINDOWS_LABEL}): un valor de hoy cerca del p90 o p10 personal es excepcional aunque el promedio se mueva poco; usa mín/máx con fecha y σ para dimensionar qué tan atípico es un día y qué tan variable es la métrica.`;
const LINE_INTENSITY = `- Cada carrera viene etiquetada por intensidad según su FC ([HIIT], [tempo], [Z2], [s/FC]; clasificada con las zonas del plan activo cuando existen) y el bloque "Por intensidad" resume n, km, ritmo y FC por tipo: úsalo para responder si un día fue HIIT o zona 2 y para evaluar el split fácil/calidad real contra la regla 80/20.`;
const LINE_INTRARUN = `- Detalle intra-carrera: SÍ tienes el pico REAL de FC de cada carrera (su "máx", calificado con la zona que alcanza), su ritmo máximo de sprint y la curva de FC intradía (muestras cada ~2 min) de los días recientes con carrera.`;
const LINE_LAPS = `- LAPS/VUELTAS: para las carreras de los últimos 15 días tienes el bloque "DETALLE DE ACTIVIDADES" con CADA vuelta (distancia, ritmo, FC prom/máx, cadencia, potencia, intensidad), el esfuerzo (TE aeróbico/anaeróbico, training load, GAP), las zonas FC en minutos, la elevación (gain/loss, min/max), el clima (temp/humedad/viento), el punto GPS de inicio y los parciales corriendo/caminando. Úsalo para responder con precisión sobre una vuelta o intervalo específico ("¿cómo estuvo mi lap 5 del martes?"). Fuera de esa ventana de 15 días solo tienes la curva intradía cada ~2 min (no captura cada sprint) — acláralo cuando importe. NUNCA digas que no tienes acceso a los picos ni a los laps: responde con el pico real, su zona, la curva y las vueltas cuando existan.`;

/**
 * Mapeo bloque emitido → línea que lo anuncia. Regla del repo (gotcha #18):
 * si agregas un builder de bloque, agrega aquí su anuncio o el modelo dirá
 * "no tengo ese dato" con el dato enfrente. El test itera esta tabla.
 *
 * `header` es el texto que identifica al bloque dentro de su sección;
 * `marker` es un fragmento estable de la línea que lo anuncia;
 * `source` dice en qué argumento del builder vive el bloque.
 */
export const BLOCK_ANNOUNCEMENTS: ReadonlyArray<{
  header: string;
  marker: string;
  source: "garmin" | "training" | "detail";
}> = [
  { header: "REGISTRO DIARIO COMPLETO", marker: "- DÍA A DÍA:", source: "garmin" },
  { header: "PASOS (meta semanal", marker: "- PASOS:", source: "garmin" },
  { header: "BODY BATTERY Y ESTRÉS INTRADÍA", marker: "- INTRADÍA:", source: "garmin" },
  { header: "COMPOSICIÓN CORPORAL", marker: "- COMPOSICIÓN CORPORAL:", source: "garmin" },
  {
    header: "Estadísticas completas por métrica",
    marker: 'Apóyate en el bloque "Estadísticas completas por métrica"',
    source: "garmin",
  },
  { header: "Carreras (todas", marker: "- ACTIVIDADES:", source: "training" },
  { header: "Por intensidad", marker: 'el bloque "Por intensidad"', source: "training" },
  { header: "Curva FC intradía", marker: "- Detalle intra-carrera:", source: "training" },
  { header: "FUERZA REGISTRADA", marker: "- FUERZA: tienes el bloque", source: "training" },
  { header: "SEMANA EN CURSO", marker: "- SEMANA: el bloque del plan activo", source: "training" },
  { header: "DETALLE DE ACTIVIDADES", marker: "- LAPS/VUELTAS:", source: "detail" },
];

function present(lines: Array<string | null | false | undefined>): string[] {
  return lines.filter((l): l is string => Boolean(l));
}

function statsInstruction(garmin: string, training: string, detail: string): string[] {
  return present([
    garmin.includes("Estadísticas completas por métrica") && LINE_STATS,
    training.includes("Por intensidad") && LINE_INTENSITY,
    training.includes("Curva FC intradía") && LINE_INTRARUN,
    detail.length > 0 && LINE_LAPS,
  ]);
}

function rawDataInstruction(garmin: string, training: string): string[] {
  return present([
    garmin.includes("REGISTRO DIARIO COMPLETO") && LINE_DAILY,
    garmin.includes("PASOS (meta semanal") && LINE_STEPS,
    training.includes("Carreras (todas") && LINE_ACTIVITIES,
    garmin.includes("BODY BATTERY Y ESTRÉS INTRADÍA") && LINE_INTRADAY,
    garmin.includes("COMPOSICIÓN CORPORAL") && LINE_COMPOSITION,
  ]);
}

function strengthInstruction(training: string, mode: CoachMode): string[] {
  return present([
    training.includes("FUERZA REGISTRADA") && LINE_STRENGTH,
    mode !== "biohacking" && training.includes("SEMANA EN CURSO") && LINE_WEEK,
  ]);
}

/* ------------------------------------------------------------------ */
/* System prompt por modo                                              */
/* ------------------------------------------------------------------ */

export function buildCoachSystemPrompt(
  garminData: string,
  biomarcadoresData: string,
  trainingData?: string,
  mode: CoachMode = "biohacking",
  activitiesDetail?: string,
  locale = "es",
  profileBlock?: string
): string {
  const g = garminData || "";
  const t = trainingData || "";
  const d = activitiesDetail || "";

  const instructions = [
    ...statsInstruction(g, t, d),
    ...rawDataInstruction(g, t),
    ...strengthInstruction(t, mode),
  ];

  let body: string[];
  if (mode === "planner") {
    body = [
      `Eres el editor de planes de entrenamiento del usuario. Además de responder preguntas, puedes MODIFICAR su plan, REGISTRAR entrenamientos y ejercicios, y DESHACER cambios (el sistema ejecuta la acción; tú confirmas con claridad qué se hizo).`,
      ``,
      `Tu estilo:`,
      `- Directo, sin relleno.`,
      `- Cuando el usuario pida un cambio al plan, descríbelo claro; el sistema lo aplica y podrá deshacerse.`,
      `- Si registras un ejercicio que no existe en el catálogo, pídele crearlo primero (no inventes claves).`,
      `- Usa datos reales del usuario (Garmin, laboratorio, plan) para fundamentar tus sugerencias.`,
      `- Interpreta cada métrica contra la tendencia personal del usuario (su baseline de ${HEALTH_WINDOW_DAYS} días), no contra rangos poblacionales genéricos: un mismo valor puede ser bueno para una persona y malo para otra según su propia tendencia. Usa los bloques "Hoy vs. baseline personal", los promedios ${TREND_WINDOWS_LABEL} y la tendencia semanal, y di claramente qué va mejorando y qué va empeorando.`,
      ...instructions,
      `- Cuando el usuario pida un cambio sin decir la semana, el cambio va a la SEMANA EN CURSO. Si pide algo recurrente ("los domingos son descanso"), aplica de la semana en curso en adelante — nunca a semanas ya entrenadas.`,
      `- Si no hay plan activo, dilo y ofrece crear uno.`,
    ];
  } else if (mode === "training") {
    body = [
      `Eres un coach de running y entrenamiento personal experto. Tienes acceso a los datos reales de entrenamiento y recuperación del usuario.`,
      ``,
      `Eres SOLO consulta: respondes preguntas y ayudas a visualizar/interpretar el plan y los datos. NO puedes modificar el plan, crear o borrar carreras, cambiar sesiones, distancias ni entrenamientos. Si el usuario pide un cambio, explica qué recomendarías, pero aclara que tú no lo aplicas (hay otro chat para editar el plan). Nunca afirmes haber modificado nada.`,
      ``,
      `Tu estilo:`,
      `- Directo, sin relleno. Ve al grano.`,
      `- Enfócate SOLO en entrenamiento: sesiones, distancias, ritmos, zonas, fuerza y recuperación.`,
      `- NUNCA menciones datos clínicos, laboratorios ni biomarcadores. Si el usuario pregunta por su semana o por un día, responde solo con información de entrenamiento.`,
      `- NUNCA uses la palabra "rodaje" o "rodajes" (es de ciclismo y el usuario no anda en bicicleta). Di "carrera", "trote", "carrera suave" o "sesión de carrera".`,
      `- Usa datos específicos del usuario, no generalidades.`,
      `- Interpreta cada métrica contra la tendencia personal del usuario (su baseline de ${HEALTH_WINDOW_DAYS} días), no contra rangos poblacionales genéricos: un mismo valor puede ser bueno para una persona y malo para otra según su propia tendencia. Cuando pregunte cómo va, evalúa con los bloques "Hoy vs. baseline personal", los promedios ${TREND_WINDOWS_LABEL} y la tendencia semanal, y di claramente qué va mejorando y qué va empeorando.`,
      ...instructions,
      `- Si no tienes datos suficientes para responder algo, dilo claramente.`,
      `- Correlaciona recuperación (sueño, HRV, estrés, body battery) con carga de entrenamiento cuando sea relevante.`,
    ];
  } else {
    body = [
      `Eres un coach de biohacking y entrenamiento personal experto. Tienes acceso a los datos reales de salud y entrenamiento del usuario.`,
      ``,
      `Tu estilo:`,
      `- Directo, sin relleno. Ve al grano.`,
      `- Haz correlaciones entre métricas de Garmin, resultados de laboratorio y entrenamiento cuando sea relevante.`,
      `- Si un biomarcador está fuera de rango, menciónalo proactivamente y cómo afecta su entrenamiento.`,
      `- Usa datos específicos del usuario, no generalidades.`,
      `- Interpreta cada métrica contra la tendencia personal del usuario (su baseline de ${HEALTH_WINDOW_DAYS} días), no contra rangos poblacionales genéricos: un mismo valor puede ser bueno para una persona y malo para otra según su propia tendencia. Cuando pregunte cómo va (su vida, su semana, su progreso), evalúa con los bloques "Hoy vs. baseline personal", los promedios ${TREND_WINDOWS_LABEL} y la tendencia semanal, y di claramente qué va mejorando y qué va empeorando.`,
      ...instructions,
      `- Si no tienes datos suficientes para responder algo, dilo claramente.`,
      `- No eres médico, pero puedes dar contexto educativo sobre los biomarcadores.`,
      `- Si el usuario tiene un plan de entrenamiento activo, considera sus objetivos y progreso en tus respuestas.`,
      `- Correlaciona recuperación (sueño, HRV, estrés, body battery) con carga de entrenamiento.`,
    ];
  }

  const sections: string[] = [];
  if (profileBlock) {
    sections.push(`=== PERFIL Y ANCLA TEMPORAL ===\n${profileBlock}`);
  }
  sections.push(
    `=== DATOS DE GARMIN (últimos ${HEALTH_WINDOW_DAYS} días) ===\n${garminData || "No hay datos de Garmin disponibles."}`
  );
  if (mode !== "training") {
    sections.push(
      `=== DATOS DE LABORATORIO (última sesión) ===\n${biomarcadoresData || "No hay resultados de laboratorio disponibles."}`
    );
  }
  sections.push(
    `=== ENTRENAMIENTO ===\n${trainingData || "No hay datos de entrenamiento disponibles."}`
  );
  if (activitiesDetail) {
    sections.push(
      `=== DETALLE DE ACTIVIDADES (últimos 15 días: laps, esfuerzo, zonas FC, elevación, clima, GPS) ===\n${activitiesDetail}`
    );
  }

  return [
    body.join("\n"),
    "",
    sections.join("\n\n"),
    "",
    `Responde en el idioma del usuario: ${locale}.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Bloque de entrenamiento                                             */
/* ------------------------------------------------------------------ */

export function formatTrainingData(
  activePlan: Record<string, unknown> | null,
  planWorkouts: Array<Record<string, unknown>>,
  manualWorkouts: Array<Record<string, unknown>>,
  recentActivities: Array<Record<string, unknown>>,
  mode: CoachMode = "biohacking",
  hrSamplesByDate?: Record<string, HrSample[]>,
  strengthLog?: string,
  today: string = new Date().toISOString().split("T")[0],
  timeZone = "America/Mexico_City"
): string {
  const lines: string[] = [];

  // Active plan summary
  if (activePlan) {
    lines.push(`Plan activo: "${activePlan.name}"`);

    // Ancla temporal: en qué semana del plan va el usuario HOY. Sin ella los
    // chats hablaban de "la semana" sin saber cuál, y el editor de planes
    // aplicaba los cambios a la semana 1.
    const planForAnchor = activePlan.plan_json as GeneratedPlan | null | undefined;
    if (planForAnchor?.weeks?.length) {
      lines.push(`  ${formatWeekAnchor(planForAnchor, today)}`);
    }
    lines.push(`  Objetivo: ${activePlan.goal_type} - Fecha: ${activePlan.goal_date}`);
    if (activePlan.goal_time) lines.push(`  Tiempo objetivo: ${activePlan.goal_time}`);
    if (activePlan.goal_distance_km) lines.push(`  Distancia objetivo: ${activePlan.goal_distance_km} km`);
    lines.push(`  Terreno: ${activePlan.terrain} | Dias/semana: ${activePlan.available_days}`);
    lines.push(`  Generado con: ${activePlan.llm_used}`);

    // Plan phases from plan_json
    const planJson = activePlan.plan_json as Record<string, unknown> | null;
    if (planJson?.summary) {
      const summary = planJson.summary as Record<string, unknown>;
      if (summary.phases) {
        const phases = summary.phases as Array<{ name: string; weeks: [number, number]; focus: string }>;
        lines.push(`  Fases: ${phases.map((p) => `${p.name} (sem ${p.weeks[0]}-${p.weeks[1]})`).join(", ")}`);
      }
      if (summary.peak_weekly_km) lines.push(`  Pico semanal: ${summary.peak_weekly_km} km`);
    }

    // Pace targets
    if (planJson?.pace_targets) {
      const paces = planJson.pace_targets as Record<string, string>;
      lines.push(`  Ritmos objetivo: Easy ${paces.easy} | Tempo ${paces.tempo} | Long ${paces.long_run} | Race ${paces.race}`);
    }

    // Nutrition flags from plan (excluded in training mode — no clinical data)
    if (mode !== "training" && planJson?.nutrition_flags) {
      const flags = planJson.nutrition_flags as Array<{ biomarker: string; status: string; recommendation: string }>;
      const flagged = flags.filter((f) => f.status !== "normal");
      if (flagged.length) {
        lines.push(`  Alertas nutricionales: ${flagged.map((f) => `${f.biomarker} (${f.status}): ${f.recommendation}`).join("; ")}`);
      }
    }
  }

  // Plan compliance
  if (planWorkouts.length) {
    const past = planWorkouts.filter((w) => String(w.date) <= today);
    const completed = past.filter((w) => w.status === "completed");
    const nonRest = past.filter((w) => w.workout_type !== "rest");
    const completedNonRest = completed.filter((w) => w.workout_type !== "rest");

    if (nonRest.length > 0) {
      const compliance = Math.round((completedNonRest.length / nonRest.length) * 100);
      lines.push(`\nCumplimiento del plan: ${completedNonRest.length}/${nonRest.length} entrenamientos (${compliance}%)`);
    }

    // Actual vs planned km
    const plannedKm = past.reduce((s, w) => s + (Number(w.target_distance_km) || 0), 0);
    const actualKm = past.reduce((s, w) => s + (Number(w.actual_distance_km) || 0), 0);
    if (plannedKm > 0) {
      lines.push(`  Km planeados: ${plannedKm.toFixed(1)} | Km reales: ${actualKm.toFixed(1)} (${Math.round((actualKm / plannedKm) * 100)}%)`);
    }

    // Current week detail
    const currentWeekWorkouts = planWorkouts.filter((w) => {
      const d = String(w.date);
      const base = new Date(`${today}T00:00:00Z`);
      const monday = new Date(base);
      monday.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      return d >= monday.toISOString().split("T")[0] && d <= sunday.toISOString().split("T")[0];
    });

    if (currentWeekWorkouts.length) {
      lines.push(`\nSemana actual:`);
      for (const w of currentWeekWorkouts) {
        const status = w.status === "completed" ? "OK" : String(w.date) <= today ? "PENDIENTE" : "---";
        const actual = w.actual_distance_km ? ` (real: ${Number(w.actual_distance_km).toFixed(1)} km)` : "";
        lines.push(`  ${w.date} ${w.workout_type} "${w.title}" → ${status}${actual}`);
      }
    }
  }

  // Contexto para clasificar HIIT/tempo/Z2 y calificar picos: zonas de FC del
  // plan activo si existe, más el máx personal de FC observado en el periodo.
  const allRuns = recentActivities.filter(
    (a) => String(a.activity_type || "").toLowerCase().includes("running") && Number(a.distance_meters || 0) > 0
  );
  const planJsonForZones = activePlan?.plan_json as Record<string, unknown> | null | undefined;
  const intensityCtx: RunIntensityContext = {
    hrMaxPersonal: personalHrMax(allRuns as Array<{ max_hr?: number | null }>),
    zones: (planJsonForZones?.hr_zones as HrZone[] | undefined) ?? null,
  };
  const intensityOf = (r: Row) =>
    classifyRun({ avg_hr: num(r.avg_hr), max_hr: num(r.max_hr) }, intensityCtx);

  // Recent running activities
  if (recentActivities.length) {

    // Estadísticas sobre TODAS las carreras del periodo (no solo las 10 listadas):
    // distribución de distancias, ritmos, FC y volumen semanal, con picos y fecha.
    if (allRuns.length) {
      const runRows = allRuns.map((r) => {
        const km = Number(r.distance_meters || 0) / 1000;
        const dur = Number(r.duration_seconds || 0);
        return {
          date: String(r.date || ""),
          km,
          pace: km > 0 && dur > 0 ? dur / 60 / km : null,
          hr: num(r.avg_hr),
          maxHr: num(r.max_hr),
          intensity: intensityOf(r),
        };
      });
      const totalKm = runRows.reduce((s, r) => s + r.km, 0);
      lines.push(`\nEstadísticas de carrera (últimos ${HEALTH_WINDOW_DAYS} días):`);
      lines.push(`  Carreras: ${allRuns.length} | Km totales: ${totalKm.toFixed(1)}`);

      const distStats = computeStatsWithDates(runRows, (r) => r.km, (r) => r.date);
      if (distStats) lines.push(`  Distancia por carrera (km): ${formatStatsLine(distStats, { decimals: 1 })}`);

      const paceStats = computeStatsWithDates(runRows, (r) => r.pace, (r) => r.date);
      if (paceStats) {
        lines.push(
          `  Ritmo (min/km): ${formatStatsLine(paceStats, { fmt: formatMinSec, minLabel: "mejor", maxLabel: "peor" })}`
        );
      }

      const hrStats = computeStatsWithDates(runRows, (r) => r.hr, (r) => r.date);
      if (hrStats) lines.push(`  FC promedio (bpm): ${formatStatsLine(hrStats, { decimals: 0 })}`);

      const weeklyKm = new Map<string, number>();
      for (const r of runRows) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(r.date)) continue;
        const monday = mondayOf(r.date);
        weeklyKm.set(monday, (weeklyKm.get(monday) || 0) + r.km);
      }
      const weekRows = [...weeklyKm.entries()].map(([monday, km]) => ({ date: `semana del ${monday}`, km }));
      const weekStats = computeStatsWithDates(weekRows, (r) => r.km, (r) => r.date);
      if (weekStats) lines.push(`  Volumen semanal (km): ${formatStatsLine(weekStats, { decimals: 1 })}`);

      // Desglose por intensidad (HIIT/tempo/Z2/sin FC) para que el coach pueda
      // responder "¿hoy fue HIIT o zona 2?" y evaluar el split 80/20 real.
      const intensityOrder: RunIntensity[] = ["hiit", "tempo", "z2", "sin_fc"];
      const intensityLines: string[] = [];
      for (const kind of intensityOrder) {
        const rows = runRows.filter((r) => r.intensity === kind);
        if (!rows.length) continue;
        const km = rows.reduce((s, r) => s + r.km, 0);
        let line = `    ${INTENSITY_LABEL[kind]}: n=${rows.length} | ${km.toFixed(1)} km`;
        const paceStats = computeStats(rows.map((r) => r.pace));
        if (paceStats) {
          line += ` | ritmo media ${formatMinSec(paceStats.mean)} (mejor ${formatMinSec(paceStats.min)})`;
        }
        const hrStats = computeStats(rows.map((r) => r.hr));
        if (hrStats) line += ` | FC prom media ${hrStats.mean.toFixed(0)}`;
        const spreadStats = computeStats(
          rows.map((r) => (r.maxHr != null && r.hr != null ? r.maxHr - r.hr : null))
        );
        if (spreadStats) line += ` | spread FC medio ${spreadStats.mean.toFixed(0)}`;
        intensityLines.push(line);
      }
      if (intensityLines.length) {
        lines.push(`  Por intensidad (clasificación por FC):`);
        lines.push(...intensityLines);
      }
    }

    // TODAS las carreras del periodo. Antes se cortaba en 10: de la ventana el
    // chat veía menos de dos semanas de carreras y negaba las demás.
    const runs = allRuns;

    if (runs.length) {
      lines.push(`\nCarreras (todas las del periodo, ${runs.length}, de la más reciente a la más vieja):`);
      for (const r of runs) {
        const km = (Number(r.distance_meters || 0) / 1000).toFixed(1);
        const dur = Number(r.duration_seconds || 0);
        const dist = Number(r.distance_meters || 0);
        let pace = "";
        if (dist > 0) {
          const paceMin = (dur / dist) * 1000 / 60;
          // Derive min/sec from total seconds so 59.6s rounds to the next
          // minute ("6:00") instead of the invalid "5:60".
          const totalSec = Math.round(paceMin * 60);
          const min = Math.floor(totalSec / 60);
          const sec = totalSec % 60;
          pace = `${min}:${String(sec).padStart(2, "0")}/km`;
        }
        const hr = r.avg_hr ? ` FC:${r.avg_hr}` : "";
        const peak = peakZoneLabel(num(r.max_hr), intensityCtx);
        const maxHr = r.max_hr ? ` máx:${r.max_hr}${peak ? ` (${peak})` : ""}` : "";
        const maxSpeed = Number(r.max_speed || 0);
        const sprint = maxSpeed > 0 ? ` sprint ${formatMinSec(1000 / maxSpeed / 60)}/km` : "";
        const tag = ` [${INTENSITY_LABEL[intensityOf(r)]}]`;
        // Columnas que ya estaban en la tabla y nunca salían del bloque de
        // detalle de 15 días: nombre, calorías, desnivel, cadencia, TE y VO2.
        const extra: string[] = [];
        const name = typeof r.activity_name === "string" ? r.activity_name.trim() : "";
        if (name) extra.push(`"${name}"`);
        const cal = num(r.calories);
        if (cal != null) extra.push(`${Math.round(cal)} kcal`);
        const up = num(r.elevation_gain);
        const down = num(r.elevation_loss);
        if (up != null || down != null) {
          extra.push(`↑${Math.round(up ?? 0)}/↓${Math.round(down ?? 0)} m`);
        }
        const cadence = num(r.avg_cadence);
        if (cadence != null) extra.push(`cad ${Math.round(cadence)}`);
        const te = num(r.training_effect);
        if (te != null) extra.push(`TE ${te}`);
        const vo2 = num(r.vo2max_value);
        if (vo2 != null) extra.push(`VO2 ${vo2}`);
        const extraText = extra.length ? ` | ${extra.join(" | ")}` : "";
        lines.push(`  ${r.date}: ${km} km @ ${pace}${hr}${maxHr}${sprint}${tag}${extraText}`);
      }
    }

    // Actividades que no son carrera (caminatas, bici, fuerza del reloj...).
    // Se descartaban por completo: el chat no sabía que existían.
    const others = recentActivities.filter((a) => !allRuns.includes(a));
    if (others.length) {
      lines.push(`\nOtras actividades (no carrera, ${others.length}):`);
      for (const a of others) {
        const parts: string[] = [];
        const name = typeof a.activity_name === "string" ? a.activity_name.trim() : "";
        if (name) parts.push(`"${name}"`);
        const dist = num(a.distance_meters);
        if (dist != null) parts.push(`${(dist / 1000).toFixed(1)} km`);
        const dur = num(a.duration_seconds);
        if (dur != null) parts.push(`${Math.round(dur / 60)} min`);
        const cal = num(a.calories);
        if (cal != null) parts.push(`${Math.round(cal)} kcal`);
        const hr = num(a.avg_hr);
        if (hr != null) parts.push(`FC ${hr}`);
        lines.push(`  ${a.date}: ${a.activity_type}${parts.length ? ` — ${parts.join(" | ")}` : ""}`);
      }
    }
  }

  // Curva de FC intradía de los días con carrera: la forma del entrenamiento
  // (rampas, bloques sostenidos) a resolución de ~2 min. El pico real de cada
  // carrera sigue siendo su "máx" (del reloj).
  if (hrSamplesByDate && Object.keys(hrSamplesByDate).length) {
    const cuts = intensityCuts(intensityCtx);
    const curveLines: string[] = [];
    for (const date of Object.keys(hrSamplesByDate).sort().reverse()) {
      const formatted = formatHrCurveDay(date, hrSamplesByDate[date], cuts, timeZone);
      if (formatted) curveLines.push(`  ${formatted}`);
    }
    if (curveLines.length) {
      lines.push(
        `\nCurva FC intradía de los días con carrera (muestras del reloj cada ~2 min, hora local del usuario; el pico real de cada carrera es su "máx"):`
      );
      lines.push(...curveLines);
    }
  }

  // Manual workouts (last 10)
  if (manualWorkouts.length) {
    lines.push(`\nEntrenamientos manuales recientes:`);
    for (const w of manualWorkouts.slice(0, 10)) {
      const exercises = w.exercises as Array<{ name: string; sets: Array<{ reps: number; weight?: number }> }> | null;
      const exCount = exercises?.length || 0;
      const dur = w.duration_minutes ? `${w.duration_minutes} min` : "";
      lines.push(`  ${w.date}: ${w.workout_type} "${w.title}" - ${exCount} ejercicios ${dur}`);
      if (exercises?.length) {
        for (const ex of exercises.slice(0, 3)) {
          const setInfo = ex.sets?.map((s) => `${s.reps}${s.weight ? `x${s.weight}kg` : ""}`).join(", ");
          lines.push(`    ${ex.name}: ${setInfo || "sin detalle"}`);
        }
        if (exercises.length > 3) lines.push(`    ... +${exercises.length - 3} ejercicios más`);
      }
    }
  }

  // Fuerza registrada (exercise_sets + exercise_logs). Va al final porque es
  // un bloque de varias líneas con su propio encabezado.
  if (strengthLog?.trim()) {
    lines.push(`\nFUERZA REGISTRADA (últimos ${HEALTH_WINDOW_DAYS} días):`);
    lines.push(strengthLog.trim());
  }

  return lines.length ? lines.join("\n") : "Sin datos de entrenamiento.";
}

// --- Tendencias Garmin (mismas métricas que Garmin Hoy / Tendencias) ---

type Row = Record<string, unknown>;

/** Valor numérico positivo o null (mismo filtro >0 que usaba el promedio original). */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) || n <= 0 ? null : n;
}

/** Fecha `days` días antes de dateStr (YYYY-MM-DD, aritmética UTC). */
function daysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

/** Lunes de la semana de dateStr (YYYY-MM-DD). */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().split("T")[0];
}

/** Segundos → horas (o null si no hay dato). */
function hours(v: unknown): number | null {
  const s = num(v);
  return s == null ? null : s / 3600;
}

function average(values: Array<number | null>): number | null {
  const vals = values.filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Métricas KPI de daily_summary + sueño, con su formato para los bloques de tendencia. */
interface TrendMetric {
  label: string;
  short: string;
  decimals: number;
  unit?: string;
  /** Dirección sana de la métrica: "up" = subir es mejor, "down" = bajar es
   * mejor. Sin dirección = neutra (no se califica como mejor/peor). */
  better?: "up" | "down";
  get: (row: Row) => number | null;
}

const SUMMARY_METRICS: TrendMetric[] = [
  { label: "Pasos", short: "Pasos", decimals: 0, better: "up", get: (r) => num(r.steps) },
  {
    label: "Distancia diaria (km)",
    short: "Dist",
    decimals: 1,
    unit: "km",
    better: "up",
    get: (r) => {
      const m = num(r.distance_meters);
      return m == null ? null : m / 1000;
    },
  },
  { label: "FC Reposo (bpm)", short: "FC", decimals: 0, better: "down", get: (r) => num(r.resting_hr) },
  { label: "FC mínima (bpm)", short: "FCmín", decimals: 0, better: "down", get: (r) => num(r.min_hr) },
  { label: "FC máxima (bpm)", short: "FCmáx", decimals: 0, get: (r) => num(r.max_hr) },
  { label: "Estrés", short: "Estrés", decimals: 0, better: "down", get: (r) => num(r.avg_stress) },
  { label: "Body Battery máx", short: "BBmáx", decimals: 0, better: "up", get: (r) => num(r.body_battery_high) },
  { label: "Body Battery mín", short: "BBmín", decimals: 0, better: "up", get: (r) => num(r.body_battery_low) },
  { label: "Calorías totales", short: "Cal", decimals: 0, get: (r) => num(r.total_calories) },
  { label: "Calorías activas", short: "CalAct", decimals: 0, better: "up", get: (r) => num(r.active_calories) },
  { label: "SpO2 (%)", short: "SpO2", decimals: 1, better: "up", get: (r) => num(r.avg_spo2) },
  { label: "Respiración (rpm)", short: "Resp", decimals: 1, better: "down", get: (r) => num(r.avg_respiration) },
  { label: "HRV (ms)", short: "HRV", decimals: 0, better: "up", get: (r) => num(r.hrv_weekly_avg) },
  { label: "Pisos subidos", short: "Pisos", decimals: 0, better: "up", get: (r) => num(r.floors_climbed) },
  {
    label: "Intensidad (min/día)",
    short: "Int",
    decimals: 0,
    better: "up",
    get: (r) => {
      if (r.moderate_intensity_min == null && r.vigorous_intensity_min == null) return null;
      return Number(r.moderate_intensity_min ?? 0) + Number(r.vigorous_intensity_min ?? 0);
    },
  },
];

const SLEEP_METRICS: TrendMetric[] = [
  {
    label: "Sueño (h)",
    short: "Sueño",
    decimals: 1,
    unit: "h",
    better: "up",
    get: (r) => {
      const s = num(r.sleep_seconds);
      return s == null ? null : s / 3600;
    },
  },
  { label: "Sueño score", short: "Score", decimals: 0, better: "up", get: (r) => num(r.sleep_score) },
  // Fases del sueño: están en la tabla desde siempre y no llegaban a ningún
  // bloque, así que el coach no podía hablar de sueño profundo ni REM.
  { label: "Sueño profundo (h)", short: "Prof", decimals: 1, unit: "h", better: "up", get: (r) => hours(r.deep_sleep_seconds) },
  { label: "Sueño ligero (h)", short: "Lig", decimals: 1, unit: "h", get: (r) => hours(r.light_sleep_seconds) },
  { label: "Sueño REM (h)", short: "REM", decimals: 1, unit: "h", better: "up", get: (r) => hours(r.rem_sleep_seconds) },
  { label: "Despierto (h)", short: "Desp", decimals: 1, unit: "h", better: "down", get: (r) => hours(r.awake_seconds) },
];

/** Desviaciones menores a esto (en %) cuentan como "en su baseline"/"estable". */
const BASELINE_STABLE_PCT = 5;

export function formatGarminSummary(
  summaries: Array<Row>,
  sleepData: Array<Row>,
  weightHistory: Array<{ date: string; weightKg: number }> = [],
  activities: Array<{ date: string; vo2max_value?: number | null }> = []
): string {
  if (!summaries?.length) return "Sin datos.";

  const lines: string[] = [];
  const latest = summaries[summaries.length - 1];

  // VO2 max por actividad (la última con dato de cada día gana) y peso de báscula
  const vo2Trend = extractVo2maxTrend(activities);
  const latestVo2 = vo2Trend.length ? vo2Trend[vo2Trend.length - 1] : null;
  const latestWeight = weightHistory.length ? weightHistory[weightHistory.length - 1] : null;

  // Latest day snapshot — las 12 métricas KPI de "Garmin Hoy"
  lines.push(`Último día (${latest.date}):`);
  if (latest.steps != null) lines.push(`  Pasos: ${latest.steps}`);
  if (latest.distance_meters != null) {
    lines.push(`  Distancia total: ${(Number(latest.distance_meters) / 1000).toFixed(1)} km`);
  }
  if (latest.resting_hr != null) lines.push(`  FC Reposo: ${latest.resting_hr} bpm`);
  if (latest.min_hr != null || latest.max_hr != null) {
    lines.push(`  FC mín/máx: ${latest.min_hr ?? "—"} / ${latest.max_hr ?? "—"} bpm`);
  }
  if (latest.avg_stress != null) lines.push(`  Estrés promedio: ${latest.avg_stress}/100`);
  if (latest.body_battery_high != null) lines.push(`  Body Battery: ${latest.body_battery_high} → ${latest.body_battery_low}`);
  if (latest.total_calories != null) lines.push(`  Calorías: ${latest.total_calories} (activas: ${latest.active_calories})`);
  if (latest.avg_spo2 != null) lines.push(`  SpO2: ${latest.avg_spo2}%`);
  if (latest.avg_respiration != null) lines.push(`  Respiración: ${latest.avg_respiration} rpm`);
  if (latest.hrv_weekly_avg != null) {
    lines.push(`  HRV: ${latest.hrv_weekly_avg} ms${latest.hrv_status ? ` (${latest.hrv_status})` : ""}`);
  } else if (latest.hrv_status != null) {
    lines.push(`  HRV: ${latest.hrv_status}`);
  }
  if (latest.floors_climbed != null) lines.push(`  Pisos: ${latest.floors_climbed} subidos / ${latest.floors_descended ?? 0} bajados`);
  if (latest.moderate_intensity_min != null || latest.vigorous_intensity_min != null) {
    const mod = Number(latest.moderate_intensity_min ?? 0);
    const vig = Number(latest.vigorous_intensity_min ?? 0);
    lines.push(`  Intensidad: ${mod + vig} min (moderada ${mod} + vigorosa ${vig})`);
  }
  if (latestVo2) lines.push(`  VO2 max: ${latestVo2.vo2max} (${latestVo2.date})`);
  if (latestWeight) lines.push(`  Peso: ${latestWeight.weightKg.toFixed(1)} kg (${latestWeight.date})`);

  // Sleep (última noche + promedio del periodo)
  if (sleepData?.length) {
    const latestSleep = sleepData[sleepData.length - 1];
    const sleepHrs = latestSleep.sleep_seconds ? (Number(latestSleep.sleep_seconds) / 3600).toFixed(1) : null;
    if (sleepHrs) lines.push(`\nSueño último día: ${sleepHrs}h (score: ${latestSleep.sleep_score || "N/A"})`);

    // Fases de la última noche (profundo/ligero/REM/despierto), en minutos.
    const phase = (v: unknown) => {
      const s = num(v);
      return s == null ? null : `${Math.round(s / 60)}m`;
    };
    const phases = [
      phase(latestSleep.deep_sleep_seconds) && `Profundo ${phase(latestSleep.deep_sleep_seconds)}`,
      phase(latestSleep.light_sleep_seconds) && `Ligero ${phase(latestSleep.light_sleep_seconds)}`,
      phase(latestSleep.rem_sleep_seconds) && `REM ${phase(latestSleep.rem_sleep_seconds)}`,
      phase(latestSleep.awake_seconds) && `Despierto ${phase(latestSleep.awake_seconds)}`,
    ].filter(Boolean);
    if (phases.length) lines.push(`  Fases: ${phases.join(" | ")}`);

    const avgSleep = sleepData
      .map((s) => Number(s.sleep_seconds))
      .filter((v) => !isNaN(v) && v > 0);
    if (avgSleep.length) {
      const avgH = (avgSleep.reduce((a, b) => a + b, 0) / avgSleep.length / 3600).toFixed(1);
      lines.push(`  Promedio sueño: ${avgH}h`);
    }
  }

  // Promedios por rango (TREND_WINDOWS, recortados a la ventana de datos),
  // relativos al último día con datos para que el bloque sea determinístico.
  const latestDate = String(latest.date);
  const inWindow = (rows: Array<Row>, days: number) => {
    const cutoff = daysBefore(latestDate, days - 1);
    return rows.filter((r) => String(r.date) >= cutoff && String(r.date) <= latestDate);
  };

  // Hoy vs. baseline personal: el valor de hoy comparado contra el promedio de
  // los días PREVIOS (el baseline del propio usuario). Un mismo valor puede ser
  // bueno para una persona y malo para otra — lo que importa es la desviación
  // contra su tendencia, calificada según la dirección sana de cada métrica.
  const baselineLines: string[] = [];
  const pushBaselineLine = (metric: TrendMetric, rows: Array<Row>) => {
    if (rows.length < 2) return;
    const todayV = metric.get(rows[rows.length - 1]);
    if (todayV == null) return;
    const base = average(rows.slice(0, -1).map(metric.get));
    if (base == null || base === 0) return;
    const dev = ((todayV - base) / base) * 100;

    // Tendencia reciente: promedio de 7d contra el promedio de TODA la ventana.
    // Tiene que ser la ventana real y no un 90 fijo: con menos días de datos,
    // `inWindow(rows, 90)` devuelve exactamente lo mismo que la ventana entera
    // y la comparación se vuelve un sinsentido silencioso (siempre "estable").
    let trendWord = "estable";
    const avg7 = average(inWindow(rows, 7).map(metric.get));
    const avgWindow = average(inWindow(rows, HEALTH_WINDOW_DAYS).map(metric.get));
    if (avg7 != null && avgWindow != null && avgWindow !== 0) {
      const t = ((avg7 - avgWindow) / avgWindow) * 100;
      if (Math.abs(t) >= BASELINE_STABLE_PCT) {
        if (metric.better) {
          trendWord = (t > 0) === (metric.better === "up") ? "mejorando" : "empeorando";
        } else {
          trendWord = t > 0 ? "subiendo" : "bajando";
        }
      }
    }

    let qualifier = "";
    if (metric.better) {
      qualifier =
        Math.abs(dev) < BASELINE_STABLE_PCT
          ? "en su baseline"
          : (dev > 0) === (metric.better === "up")
            ? "mejor que su baseline"
            : "peor que su baseline";
      qualifier += "; ";
    }

    const sign = dev >= 0 ? "+" : "";
    baselineLines.push(
      `  ${metric.label}: hoy ${todayV.toFixed(metric.decimals)} | baseline ${base.toFixed(metric.decimals)} | ${sign}${dev.toFixed(1)}% (${qualifier}tendencia: ${trendWord})`
    );
  };
  for (const metric of SUMMARY_METRICS) pushBaselineLine(metric, summaries);
  for (const metric of SLEEP_METRICS) pushBaselineLine(metric, sleepData || []);

  if (baselineLines.length) {
    lines.push(`\nHoy vs. baseline personal (promedio de sus días previos):`);
    lines.push(...baselineLines);
  }

  const rangeLines: string[] = [];
  const pushRangeLine = (metric: TrendMetric, rows: Array<Row>) => {
    const perWindow = TREND_WINDOWS.map((days) => average(inWindow(rows, days).map(metric.get)));
    if (perWindow.every((v) => v == null)) return;
    const formatted = perWindow.map((v) => (v == null ? "—" : v.toFixed(metric.decimals)));
    rangeLines.push(`  ${metric.label}: ${formatted.join(" / ")}`);
  };
  for (const metric of SUMMARY_METRICS) pushRangeLine(metric, summaries);
  for (const metric of SLEEP_METRICS) pushRangeLine(metric, sleepData || []);

  if (rangeLines.length) {
    lines.push(`\nPromedios ${TREND_WINDOWS_LABEL} días (días con dato, hasta ${latestDate}):`);
    lines.push(...rangeLines);
  }

  // Estadísticas completas por métrica y ventana: percentiles, picos con fecha
  // y desviación estándar — el promedio solo no distingue un día p90 de uno p50.
  const statBlocks: string[] = [];
  const pushStatBlock = (metric: TrendMetric, rows: Array<Row>) => {
    const windowLines: string[] = [];
    for (const days of TREND_WINDOWS) {
      const stats = computeStatsWithDates(inWindow(rows, days), metric.get, (r) => String(r.date));
      if (!stats) continue;
      windowLines.push(
        `    ${days}d: ${formatStatsLine(stats, { decimals: metric.decimals, unit: metric.unit })}`
      );
    }
    if (windowLines.length) statBlocks.push(`  ${metric.label}:`, ...windowLines);
  };
  for (const metric of SUMMARY_METRICS) pushStatBlock(metric, summaries);
  for (const metric of SLEEP_METRICS) pushStatBlock(metric, sleepData || []);

  if (statBlocks.length) {
    lines.push(`\nEstadísticas completas por métrica (ventanas ${TREND_WINDOWS_LABEL} días hasta ${latestDate}):`);
    lines.push(...statBlocks);
  }

  // Tendencia semanal: promedio diario por semana (lunes) para ver la forma
  // de la curva de cada métrica, no solo el promedio del rango.
  const weeks = new Map<string, { summaries: Row[]; sleep: Row[] }>();
  const weekOf = (dateStr: string) => {
    const key = mondayOf(dateStr);
    if (!weeks.has(key)) weeks.set(key, { summaries: [], sleep: [] });
    return weeks.get(key)!;
  };
  for (const s of summaries) weekOf(String(s.date)).summaries.push(s);
  for (const s of sleepData || []) weekOf(String(s.date)).sleep.push(s);

  const weekLines: string[] = [];
  for (const [monday, group] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const segments: string[] = [];
    for (const metric of SUMMARY_METRICS) {
      const v = average(group.summaries.map(metric.get));
      if (v != null) segments.push(`${metric.short} ${v.toFixed(metric.decimals)}`);
    }
    for (const metric of SLEEP_METRICS) {
      const v = average(group.sleep.map(metric.get));
      if (v != null) segments.push(`${metric.short} ${v.toFixed(metric.decimals)}${metric.unit || ""}`);
    }
    if (segments.length) weekLines.push(`  ${monday}: ${segments.join(" | ")}`);
  }
  if (weekLines.length) {
    lines.push(`\nTendencia semanal (promedio diario por semana, del lunes indicado):`);
    lines.push(...weekLines);
  }

  // VO2 max y peso: series esporádicas, se listan completas (igual que las
  // gráficas de Tendencias, que no las recortan al rango).
  if (vo2Trend.length) {
    lines.push(`\nVO2 max (por actividad): ${vo2Trend.map((p) => `${p.date}: ${p.vo2max}`).join(" | ")}`);
  }
  if (weightHistory.length) {
    lines.push(`\nPeso (historial completo, kg): ${weightHistory.map((p) => `${p.date}: ${p.weightKg.toFixed(1)}`).join(" | ")}`);
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Labs                                                                */
/* ------------------------------------------------------------------ */

export function formatBiomarcadoresResults(
  results: Array<{
    category: string;
    test_name: string;
    result: number | null;
    result_text: string | null;
    unit: string;
    reference_min: number | null;
    reference_max: number | null;
    is_flagged: boolean;
  }>,
  sampleDate: string
): string {
  if (!results?.length) return "Sin resultados.";

  const lines: string[] = [`Fecha de muestra: ${sampleDate}`];
  let currentCat = "";

  for (const r of results) {
    if (r.category !== currentCat) {
      currentCat = r.category;
      lines.push(`\n[${currentCat}]`);
    }
    const val = r.result != null ? r.result : r.result_text || "—";
    const ref = r.reference_min != null && r.reference_max != null
      ? ` (ref: ${r.reference_min}-${r.reference_max})`
      : "";
    const flag = r.is_flagged ? " ⚠️" : "";
    lines.push(`  ${r.test_name}: ${val} ${r.unit || ""}${ref}${flag}`);
  }

  return lines.join("\n");
}

/** Fila de "alterados históricos" (lab_results con is_flagged de toda sesión). */
export interface FlaggedHistoryRow {
  sampleDate: string | null;
  category: string;
  testName: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
}

/**
 * Alterados históricos (spec doc 08 §10): además de la última sesión completa,
 * el coach ve qué biomarcadores han salido fuera de rango en CUALQUIER sesión,
 * con su fecha — sin esto no puede hablar de la evolución de un marcador.
 */
export function formatFlaggedHistory(rows: FlaggedHistoryRow[]): string {
  if (!rows?.length) return "";
  const lines = ["Alterados históricos (todas las sesiones, más reciente primero):"];
  for (const r of rows) {
    const val = r.valueNum != null ? r.valueNum : r.valueText || "—";
    const ref = r.refLow != null && r.refHigh != null ? ` (ref: ${r.refLow}-${r.refHigh})` : "";
    lines.push(`  ${r.sampleDate ?? "s/fecha"} | [${r.category}] ${r.testName}: ${val} ${r.unit || ""}${ref}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Perfil + ancla temporal (spec doc 08 §1–2)                          */
/* ------------------------------------------------------------------ */

export interface ProfileBlockInput {
  age?: number | null;
  sex?: string | null;
  maxHr?: number | null;
  timezone: string;
  providers?: string[];
  stepsGoal?: { min: number; max: number } | null;
  planName?: string | null;
  /** YYYY-MM-DD en la tz del usuario — el ancla "HOY" sale de aquí. */
  today: string;
}

/** 150000 → "150,000" (sin depender del locale del runtime). */
function withThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Años completos entre birthDate y today (ambas YYYY-MM-DD); null si inválida. */
export function computeAge(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const b = birthDate.slice(0, 10);
  let age = Number(today.slice(0, 4)) - Number(b.slice(0, 4));
  if (today.slice(5) < b.slice(5)) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * Bloque de perfil + ancla temporal. Fue un bug real del original: sin el
 * "HOY:" el LLM no sabía ni qué día era. Sin nombres ni identificadores
 * personales — solo lo que el coach necesita para interpretar los datos.
 */
export function formatProfileBlock(input: ProfileBlockInput): string {
  const lines: string[] = [];
  const personal = [
    input.age != null ? `Edad: ${input.age}` : null,
    input.sex ? `Sexo: ${input.sex}` : null,
    input.maxHr ? `FC máx: ${input.maxHr}` : null,
  ].filter(Boolean);
  if (personal.length) lines.push(personal.join(" | "));
  const providers = input.providers?.length
    ? ` | Proveedores conectados: ${input.providers.join(", ")}`
    : "";
  lines.push(`Zona horaria: ${input.timezone}${providers}`);
  if (input.stepsGoal) {
    lines.push(
      `Meta de pasos semanal: ${withThousands(input.stepsGoal.min)}–${withThousands(input.stepsGoal.max)}`
    );
  }
  if (input.planName) lines.push(`Plan activo: "${input.planName}"`);
  lines.push(`HOY: ${input.today} (${weekdayLabel(input.today)}).`);
  return lines.join("\n");
}
