/**
 * Contexto de salud del coach (spec doc 08) — port de fetchHealthData de
 * el-consejo sobre los repos canónicos de Pulso.
 *
 * Arquitectura: TODO el formateo vive en builders puros (coach-prompt.ts y los
 * formatters de lib/health y lib/training, portados byte-fiel). Este módulo es
 * la capa de I/O: trae filas canónicas vía repos (siempre con Viewer), las
 * ADAPTA al shape legado que consumen los builders (mismo patrón que
 * lib/training/adapter.ts: la lógica portada no se toca, el esquema se absorbe
 * aquí) y arma el prompt. Reglas duras portadas:
 *
 * - HEALTH_WINDOW_DAYS decide filtros Y etiquetas (una sola perilla).
 * - Series intradía se piden DÍA POR DÍA en paralelo, nunca IN(fechas).
 * - El prompt es determinístico por (usuario, feature, día-en-tz-del-usuario):
 *   memo de 5 min en lib/llm/prompt-cache y cero timestamps con hora "actual".
 * - Presupuesto: si el prompt excede MAX_CONTEXT_TOKENS se recorta por bloques
 *   (context-trim.ts) y el recorte queda anotado dentro del prompt.
 * - Bloques sin datos se OMITEN, y la instrucción de datos crudos solo anuncia
 *   los bloques presentes (coach-prompt.ts).
 */
import type { Viewer } from "@/lib/authz/viewer";
import type {
  BodyMeasurementRow,
  HealthDayRow,
  SleepSessionRow,
  WorkoutRow,
} from "@/lib/db/schema";
import {
  bodyMeasurementsRange,
  connectionsList,
  healthDaysRange,
  MAX_RANGE_DAYS,
  samplesForDay,
  sleepRange,
  workoutDetail,
  workoutsRange,
} from "@/lib/db/repos/health";
import { listDefinitions, listLogs, listSets } from "@/lib/db/repos/exercises";
import { getProfile } from "@/lib/db/repos/profiles";
import { flaggedHistory, listSessions, sessionResults } from "@/lib/db/repos/labs";
import {
  activePlan as fetchActivePlan,
  getTrainingSettings,
  listManualWorkouts,
  planWorkoutsForPlan,
} from "@/lib/db/repos/training";
import { getEnv } from "@/lib/env";
import {
  getCachedPrompt,
  promptCacheKey,
  setCachedPrompt,
} from "@/lib/llm/prompt-cache";
import { mergeHealthDay } from "@/lib/health/merge";
import { formatDailyLog, formatStepsBlock } from "@/lib/health/daily-log";
import { formatBodyBatteryStressBlock, type DaySamples } from "@/lib/health/bb-stress";
import { buildWeightHistory, formatBodyComposition, type BodyCompositionRow } from "@/lib/health/weight";
import { formatRecentActivitiesDetail } from "@/lib/health/recent-activities-detail";
import { ELEVATED_HR_THRESHOLD, type HrSample } from "@/lib/health/hr-intraday";
import { formatStrengthLog } from "@/lib/training/strength-summary";
import { normalizeStepsGoal } from "@/lib/training/week-tracks";
import { dateInTz, daysBefore, healthWindowFrom, todayInTz } from "@/lib/health/tz";
import {
  ACTIVITY_DETAIL_BLOCK,
  DAILY_LOG_BLOCK,
  trimContextToBudget,
  type ContextBlock,
} from "@/lib/health/context-trim";
import {
  buildCoachSystemPrompt,
  computeAge,
  formatBiomarcadoresResults,
  formatFlaggedHistory,
  formatGarminSummary,
  formatProfileBlock,
  formatTrainingData,
  type CoachMode,
} from "@/lib/health/coach-prompt";

/** Días de muestras intradía (Body Battery/estrés) que se resumen al prompt. */
const INTRADAY_DAYS = 7;
/** Días de detalle rico por actividad (laps, clima, zonas). */
const DETAIL_DAYS = 15;
/** Días con carrera cuya curva de FC intradía viaja al prompt. */
const HR_CURVE_RUN_DAYS = 7;

export type CoachKind = "coach" | "tracking" | "planner";

const KIND_TO_MODE: Record<CoachKind, CoachMode> = {
  coach: "biohacking",
  tracking: "training",
  planner: "planner",
};

export interface HealthContext {
  prompt: string;
  /** "memo" cuando el prompt salió del memo de 5 min (byte-idéntico). */
  contextSource: "memo" | "fresh";
}

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Adaptadores canónico → shape legado de los builders portados         */
/* ------------------------------------------------------------------ */

/** health_days (merge multi-proveedor) → fila estilo daily_summary. */
function toLegacySummaryRow(m: NonNullable<ReturnType<typeof mergeHealthDay>>): Row {
  return {
    date: m.date,
    steps: m.steps,
    distance_meters: m.distanceM,
    total_calories: m.caloriesTotal,
    active_calories: m.caloriesActive,
    resting_hr: m.restingHr,
    min_hr: m.hrMin,
    max_hr: m.hrMax,
    avg_stress: m.stressAvg,
    body_battery_high: m.bodyBatteryHigh,
    body_battery_low: m.bodyBatteryLow,
    avg_spo2: m.spo2Avg,
    avg_respiration: m.respirationAvg,
    hrv_weekly_avg: m.hrvMs,
    hrv_status: m.hrvStatus,
    floors_climbed: m.floors,
    floors_descended: null,
    // El esquema canónico guarda el TOTAL de minutos de intensidad; el shape
    // legado los separaba en moderada/vigorosa. El total va en "moderada" y la
    // vigorosa queda nula para que la suma (lo único que usan los bloques) sea
    // correcta.
    moderate_intensity_min: m.intensityMinutes,
    vigorous_intensity_min: null,
  };
}

const secs = (min: number | null) => (min == null ? null : min * 60);

/** sleep_sessions → fila estilo sleep (segundos + horario ISO). */
function toLegacySleepRow(s: SleepSessionRow, date: string): Row {
  return {
    date,
    sleep_seconds: secs(s.totalMin),
    sleep_score: s.score,
    deep_sleep_seconds: secs(s.deepMin),
    light_sleep_seconds: secs(s.lightMin),
    rem_sleep_seconds: secs(s.remMin),
    awake_seconds: secs(s.awakeMin),
    sleep_start: s.startAt.toISOString(),
    sleep_end: s.endAt.toISOString(),
  };
}

/**
 * Una noche por fecha (fecha = día en que TERMINA el sueño, en la tz del
 * usuario): gana el proveedor primario y, a igualdad, la sesión más larga.
 * Las siestas no cuentan como "la noche".
 */
function pickSleepPerDate(
  sessions: SleepSessionRow[],
  tz: string,
  primaryProvider: string | null,
): Row[] {
  const byDate = new Map<string, SleepSessionRow>();
  for (const s of sessions) {
    if (s.isNap) continue;
    const date = dateInTz(s.endAt, tz);
    const cur = byDate.get(date);
    if (!cur) {
      byDate.set(date, s);
      continue;
    }
    const curPrimary = cur.provider === primaryProvider;
    const sPrimary = s.provider === primaryProvider;
    if (sPrimary !== curPrimary ? sPrimary : (s.totalMin ?? 0) > (cur.totalMin ?? 0)) {
      byDate.set(date, s);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, s]) => toLegacySleepRow(s, date));
}

/** workouts → fila estilo activities (fecha calendario en tz del usuario). */
function toLegacyActivity(w: WorkoutRow, tz: string): Row {
  return {
    activity_id: w.id,
    date: dateInTz(w.startAt, tz),
    activity_type: w.sport,
    activity_name: w.name,
    distance_meters: w.distanceM,
    duration_seconds: w.durationS,
    avg_hr: w.hrAvg,
    max_hr: w.hrMax,
    calories: w.calories,
    elevation_gain: w.elevationGainM,
    elevation_loss: w.elevationLossM,
    avg_cadence: w.cadenceAvg,
    training_effect: w.aerobicTe,
    vo2max_value: w.vo2max,
    max_speed: w.speedMaxMps,
    aerobic_training_effect: w.aerobicTe,
    anaerobic_training_effect: w.anaerobicTe,
    training_load: w.trainingLoad,
    avg_grade_adjusted_speed_mps: w.gapMps,
    moving_duration_seconds: w.movingS,
  };
}

type WorkoutDetailResult = NonNullable<Awaited<ReturnType<typeof workoutDetail>>>;

/** workout_laps (kind 'lap') → fila estilo activity_laps. */
function toLegacyLap(l: WorkoutDetailResult["laps"][number]): Row {
  return {
    lap_index: l.lapIndex,
    intensity_type: l.intensityType,
    distance_meters: l.distanceM,
    duration_seconds: l.durationS,
    avg_hr: l.hrAvg,
    max_hr: l.hrMax,
    avg_run_cadence_spm: l.cadenceAvg,
    avg_power_w: l.powerAvgW,
    stride_length_cm: l.strideLengthCm,
    vertical_oscillation_cm: l.verticalOscillationCm,
    vertical_ratio: l.verticalRatio,
    ground_contact_time_ms: l.groundContactTimeMs,
    elevation_gain_m: l.elevationGainM,
    elevation_loss_m: l.elevationLossM,
    start_latitude: l.startLat,
    start_longitude: l.startLng,
    end_latitude: l.endLat,
    end_longitude: l.endLng,
  };
}

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function degreesToCompass(deg: number | null): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** workout_weather (°C canónico) → shape legado (formatWeather espera °F). */
function toLegacyWeather(wx: WorkoutDetailResult["weather"]): Row | null {
  if (!wx) return null;
  const cToF = (c: number | null) => (c == null ? null : (c * 9) / 5 + 32);
  return {
    temp: cToF(wx.tempC),
    apparent_temp: cToF(wx.apparentTempC),
    dew_point: cToF(wx.dewPointC),
    relative_humidity: wx.relativeHumidity,
    wind_speed: wx.windSpeedMs,
    wind_direction_compass: degreesToCompass(wx.windDirectionDeg),
    weather_type: null,
  };
}

/** Zonas FC + splits + TE del detalle → raw_summary legado. */
function detailRawSummary(detail: WorkoutDetailResult): Row {
  const raw: Row = {};
  if (detail.workout.teLabel) raw.trainingEffectLabel = detail.workout.teLabel;
  for (const z of detail.zones) {
    if (z.zone >= 1 && z.zone <= 5) raw[`hrTimeInZone_${z.zone}`] = z.seconds;
  }
  const splits = detail.laps
    .filter((l) => l.kind === "split")
    .map((l) => ({
      splitType: l.intensityType,
      distance: l.distanceM,
      duration: l.durationS,
    }));
  if (splits.length) raw.splitSummaries = splits;
  return raw;
}

/** body_measurements → fila estilo body_composition (gramos, fecha en tz). */
function toLegacyBodyComp(b: BodyMeasurementRow, tz: string): BodyCompositionRow {
  const grams = (kg: number | null) => (kg == null ? null : kg * 1000);
  return {
    date: dateInTz(b.measuredAt, tz),
    weight_grams: grams(b.weightKg),
    bmi: b.bmi,
    body_fat_pct: b.bodyFatPct,
    muscle_mass_grams: grams(b.muscleMassKg),
    body_water_pct: b.bodyWaterPct,
    bone_mass_grams: grams(b.boneMassKg),
  };
}

/* ------------------------------------------------------------------ */
/* Builder principal                                                   */
/* ------------------------------------------------------------------ */

export interface BuildHealthContextOpts {
  /** Reloj inyectable (memo/TTL); el "hoy" del prompt deriva de aquí + tz. */
  now?: () => number;
}

export async function buildHealthContext(
  viewer: Viewer,
  kind: CoachKind,
  opts: BuildHealthContextOpts = {},
): Promise<HealthContext> {
  const now = opts.now ?? Date.now;
  const mode = KIND_TO_MODE[kind];

  const profile = await getProfile(viewer);
  const tz = profile.timezone || "UTC";
  const today = todayInTz(tz, new Date(now()));

  // Memo primero: el prompt caching del proveedor exige un prefijo
  // byte-idéntico y este prompt sale de ~10 queries vivas. Ver prompt-cache.ts.
  const cacheKey = promptCacheKey(viewer.effectiveUserId, kind, today);
  const cached = await getCachedPrompt(cacheKey, now());
  if (cached) return { prompt: cached, contextSource: "memo" };

  // La MISMA constante decide este filtro y las etiquetas del prompt.
  const from = healthWindowFrom(today);

  const [
    healthDayRows,
    sleepRows,
    workoutRows,
    bodyRows,
    connections,
    strengthSets,
    bodyweightLogs,
    exerciseDefs,
    settings,
    plan,
    manualRows,
  ] = await Promise.all([
    healthDaysRange(viewer, from, today),
    sleepRange(viewer, from, today),
    workoutsRange(viewer, from, today, { limit: 500 }),
    // Composición corporal: el original traía el historial completo; los repos
    // de Pulso acotan rangos a MAX_RANGE_DAYS, así que viaja el último año.
    bodyMeasurementsRange(viewer, daysBefore(today, MAX_RANGE_DAYS), today),
    connectionsList(viewer),
    listSets(viewer, { from, to: today }),
    listLogs(viewer, { from, to: today }),
    listDefinitions(viewer),
    getTrainingSettings(viewer),
    fetchActivePlan(viewer),
    listManualWorkouts(viewer, from, today),
  ]);

  // Merge multi-proveedor por fecha; el primario del perfil gana campo a campo.
  const byDate = new Map<string, HealthDayRow[]>();
  for (const r of healthDayRows) {
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  }
  const legacySummaries = [...byDate.keys()]
    .sort()
    .map((d) => mergeHealthDay(byDate.get(d)!, profile.primaryProvider))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map(toLegacySummaryRow);

  const legacySleep = pickSleepPerDate(sleepRows, tz, profile.primaryProvider);
  const legacyActivities = workoutRows.map((w) => toLegacyActivity(w, tz));
  const legacyBodyComp = bodyRows.map((b) => toLegacyBodyComp(b, tz));

  // Labs (nunca en modo training — cero datos clínicos ahí).
  let biomarcadoresText = "";
  if (mode !== "training") {
    const sessions = await listSessions(viewer);
    const latest = sessions.find((s) => s.status === "completed") ?? null;
    const [results, flagged] = await Promise.all([
      latest ? sessionResults(viewer, latest.id) : Promise.resolve([]),
      flaggedHistory(viewer),
    ]);
    const resultsText = latest
      ? formatBiomarcadoresResults(
          results.map((r) => ({
            category: r.category,
            test_name: r.testName,
            result: r.valueNum,
            result_text: r.valueText,
            unit: r.unit ?? "",
            reference_min: r.refLow,
            reference_max: r.refHigh,
            is_flagged: r.isFlagged,
          })),
          latest.sampleDate ?? "",
        )
      : "";
    const flaggedText = formatFlaggedHistory(
      flagged.map((f) => ({
        sampleDate: f.sampleDate,
        category: f.category,
        testName: f.testName,
        valueNum: f.valueNum,
        valueText: f.valueText,
        unit: f.unit,
        refLow: f.refLow,
        refHigh: f.refHigh,
      })),
    );
    biomarcadoresText = [resultsText && resultsText !== "Sin resultados." ? resultsText : "", flaggedText]
      .filter(Boolean)
      .join("\n\n");
  }

  // Curva de FC intradía de los días con carrera más recientes. Día por día
  // (paralelo) — regla dura portada: nunca IN(fechas).
  const runDates = [
    ...new Set(
      legacyActivities
        .filter(
          (a) =>
            String(a.activity_type || "").toLowerCase().includes("running") &&
            Number(a.distance_meters || 0) > 0,
        )
        .map((a) => String(a.date)),
    ),
  ]
    .sort()
    .reverse()
    .slice(0, HR_CURVE_RUN_DAYS);

  let hrSamplesByDate: Record<string, HrSample[]> | undefined;
  if (runDates.length) {
    const perDay = await Promise.all(runDates.map((d) => samplesForDay(viewer, d, "hr")));
    runDates.forEach((date, i) => {
      const elevated = perDay[i]
        .filter((s) => Number(s.value) >= ELEVATED_HR_THRESHOLD)
        .map((s) => ({ timestamp_ms: s.recordedAt.getTime(), heart_rate: Number(s.value) }));
      if (!elevated.length) return;
      (hrSamplesByDate ??= {})[date] = elevated;
    });
  }

  // Body Battery y estrés intradía de los últimos 7 días: también día por día.
  const intradayDates = Array.from({ length: INTRADAY_DAYS }, (_, i) => daysBefore(today, i));
  const intradayRows = await Promise.all(
    intradayDates.flatMap((date) => [
      samplesForDay(viewer, date, "body_battery"),
      samplesForDay(viewer, date, "stress"),
    ]),
  );
  const intradayByDate: Record<string, DaySamples> = {};
  intradayDates.forEach((date, i) => {
    const toLevels = (rows: Awaited<ReturnType<typeof samplesForDay>>) =>
      rows.map((r) => ({ timestamp_ms: r.recordedAt.getTime(), level: Number(r.value) }));
    const battery = toLevels(intradayRows[i * 2]);
    const stress = toLevels(intradayRows[i * 2 + 1]);
    if (!battery.length && !stress.length) return;
    intradayByDate[date] = { battery, stress };
  });

  // Detalle rico de los últimos 15 días (laps, zonas, clima, GPS) por workout.
  const detailCutoff = daysBefore(today, DETAIL_DAYS);
  const recentWorkouts = workoutRows.filter((w) => dateInTz(w.startAt, tz) >= detailCutoff);
  const details = await Promise.all(recentWorkouts.map((w) => workoutDetail(viewer, w.id)));
  const lapsByActivity: Record<string, Row[]> = {};
  const weatherByActivity: Record<string, Row> = {};
  const rawSummaryById = new Map<string, Row>();
  details.forEach((detail) => {
    if (!detail) return;
    const id = detail.workout.id;
    const laps = detail.laps.filter((l) => l.kind === "lap").map(toLegacyLap);
    if (laps.length) lapsByActivity[id] = laps;
    const wx = toLegacyWeather(detail.weather);
    if (wx) weatherByActivity[id] = wx;
    rawSummaryById.set(id, detailRawSummary(detail));
  });
  const recentLegacy = legacyActivities
    .filter((a) => String(a.date) >= detailCutoff)
    .map((a) => ({ ...a, raw_summary: rawSummaryById.get(String(a.activity_id)) ?? null }));
  const activitiesDetailText = recentLegacy.length
    ? formatRecentActivitiesDetail(recentLegacy, lapsByActivity, weatherByActivity)
    : "";

  // Bloques (los vacíos se omiten — sin bloques mentirosos).
  const stepsGoal = normalizeStepsGoal(settings?.stepsGoalMin, settings?.stepsGoalMax);
  const weightHistory = buildWeightHistory(legacyBodyComp);

  const strengthText = formatStrengthLog(
    strengthSets.map((s) => ({
      date: s.date,
      exercise: s.exerciseKey,
      set_number: s.setNumber,
      weight_kg: s.weightKg,
      reps: s.reps,
    })),
    bodyweightLogs.map((l) => ({ date: l.date, exercise: l.exerciseKey, reps: l.reps })),
    exerciseDefs.map((d) => ({
      exercise_key: d.exerciseKey,
      label: d.label,
      type: d.type,
      weekly_goal: d.weeklyGoal,
    })),
    today,
  );

  const legacyPlan: Row | null = plan
    ? {
        name: plan.name,
        goal_type: plan.goalType,
        goal_date: plan.goalDate,
        goal_time: plan.goalTime,
        goal_distance_km: plan.goalDistanceKm,
        terrain: plan.terrain,
        available_days: plan.availableDays,
        llm_used: plan.llmUsed,
        plan_json: plan.planJson,
      }
    : null;
  const planWorkouts: Row[] = plan
    ? (await planWorkoutsForPlan(viewer, plan.id)).map((w) => ({
        date: w.date,
        workout_type: w.workoutType,
        title: w.title,
        status: w.status,
        target_distance_km: w.targetDistanceKm,
        actual_distance_km: w.actualDistanceKm,
      }))
    : [];
  const legacyManual: Row[] = manualRows.map((m) => ({
    date: m.date,
    workout_type: m.workoutType,
    title: m.title,
    duration_minutes: m.durationMinutes,
    exercises: m.exercises,
  }));

  const trainingText = formatTrainingData(
    legacyPlan,
    planWorkouts,
    legacyManual,
    legacyActivities,
    mode,
    hrSamplesByDate,
    strengthText,
    today,
    tz,
  );

  // Presupuesto de contexto: recorta daily-log y detalle si el total excede.
  const { blocks } = trimContextToBudget(
    [
      { name: "summary", text: formatGarminSummary(legacySummaries, legacySleep, weightHistory, legacyActivities) },
      { name: "steps", text: formatStepsBlock(legacySummaries, stepsGoal, today) },
      { name: "composition", text: formatBodyComposition(legacyBodyComp) },
      { name: DAILY_LOG_BLOCK, text: formatDailyLog(legacySummaries, legacySleep, tz) },
      { name: "bb-stress", text: formatBodyBatteryStressBlock(intradayByDate, tz) },
      { name: ACTIVITY_DETAIL_BLOCK, text: activitiesDetailText },
      { name: "training", text: trainingText },
      { name: "labs", text: biomarcadoresText },
    ] satisfies ContextBlock[],
    getEnv().MAX_CONTEXT_TOKENS,
  );
  const blockText = (name: string) => blocks.find((b) => b.name === name)?.text ?? "";

  const garminText = ["summary", "steps", "composition", DAILY_LOG_BLOCK, "bb-stress"]
    .map(blockText)
    .filter((block) => block && block !== "Sin datos.")
    .join("\n\n");

  const profileBlock = formatProfileBlock({
    age: computeAge(profile.birthDate, today),
    sex: profile.sex,
    maxHr: profile.maxHr,
    timezone: tz,
    providers: connections.map((c) => c.provider),
    stepsGoal,
    planName: plan?.name ?? null,
    today,
  });

  const prompt = buildCoachSystemPrompt(
    garminText,
    blockText("labs"),
    blockText("training"),
    mode,
    blockText(ACTIVITY_DETAIL_BLOCK) || undefined,
    profile.locale || "es",
    profileBlock,
  );

  await setCachedPrompt(cacheKey, prompt, now());
  return { prompt, contextSource: "fresh" };
}
