/**
 * Pure row mappers for the one-shot el-consejo → Pulso data migration
 * (spec doc 13). One mapper per source/destination table pair; every function
 * is input → output with no I/O so the whole mapping is unit-testable.
 *
 * Source rows come straight from the origin Postgres via the `postgres`
 * driver, which returns numeric/bigint columns as strings — every numeric
 * field is coerced through toNum/toInt (mirrors the original app's toNum()
 * for PostgREST). Canonical units on the way in: grams→kg, °F→°C, mph→m/s,
 * epoch ms→Date (spec doc 02: meters, seconds, °C, kg, ml, ms).
 *
 * Deliberately NOT mapped (doc 13): daily_summary.avg_spo2/lowest_spo2/
 * hydration_ml (always NULL at origin), training_coach_messages (24h
 * retention), training_workouts (0 rows at origin).
 */
import { createHash } from "crypto";
import type { schema } from "@/lib/db";

type HealthDayInsert = typeof schema.healthDays.$inferInsert;
type SleepSessionInsert = typeof schema.sleepSessions.$inferInsert;
type BodyMeasurementInsert = typeof schema.bodyMeasurements.$inferInsert;
type WorkoutInsert = typeof schema.workouts.$inferInsert;
type WorkoutLapInsert = typeof schema.workoutLaps.$inferInsert;
type WorkoutWeatherInsert = typeof schema.workoutWeather.$inferInsert;
type MetricSampleInsert = typeof schema.metricSamples.$inferInsert;
type LabSessionInsert = typeof schema.labSessions.$inferInsert;
type LabResultInsert = typeof schema.labResults.$inferInsert;
type ConversationInsert = typeof schema.conversations.$inferInsert;
type MessageInsert = typeof schema.messages.$inferInsert;
type TrainingPlanInsert = typeof schema.trainingPlans.$inferInsert;
type TrainingPlanWorkoutInsert = typeof schema.trainingPlanWorkouts.$inferInsert;
type TrainingPlanVersionInsert = typeof schema.trainingPlanVersions.$inferInsert;
type TrainingSettingsInsert = typeof schema.trainingSettings.$inferInsert;
type ExerciseDefinitionInsert = typeof schema.exerciseDefinitions.$inferInsert;
type ExerciseLogInsert = typeof schema.exerciseLogs.$inferInsert;
type ExerciseSetInsert = typeof schema.exerciseSets.$inferInsert;

export const MIGRATION_PROVIDER = "garmin";

/**
 * Origin rows carry no time-of-day for sleep/body-composition and
 * `start_time_local` has no offset; the original app pinned "today" to
 * America/Mexico_City everywhere (el-consejo biohacking-spec/02 §8). CDMX has
 * no DST since 2022, so a fixed -06:00 is exact for the whole data range.
 */
export const SOURCE_UTC_OFFSET = "-06:00";

/* ------------------------------------------------------------------ */
/* Coercions                                                           */
/* ------------------------------------------------------------------ */

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

/** date column (string or Date, driver-dependent) → "YYYY-MM-DD". */
export function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function toInstant(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function gramsToKg(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : n / 1000;
}

export function fToC(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : ((n - 32) * 5) / 9;
}

/**
 * activity_weather comes from Garmin Connect's imperial weather DTO — the DDL
 * doc pins the temperatures to °F; wind speed is the same DTO's mph field
 * (the doc records no unit for it; the original app displayed it raw).
 */
export function mphToMs(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : n * 0.44704;
}

const COMPASS_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function compassToDeg(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const deg = COMPASS_DEG[String(v).toUpperCase().trim()];
  return deg === undefined ? null : deg;
}

/** Garmin weather_type → nearest WMO code (open-meteo vocabulary). */
export const WEATHER_TYPE_TO_WMO: Record<string, number> = {
  CLEAR: 0, FAIR: 0, "MOSTLY CLEAR": 1, "PARTLY CLOUDY": 2, "MOSTLY CLOUDY": 3,
  CLOUDY: 3, MIST: 45, FOG: 45, HAZE: 45, DRIZZLE: 53, "LIGHT RAIN": 61,
  RAIN: 63, SNOW: 71, THUNDERSTORM: 95,
};

export function weatherTypeToWmo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const code = WEATHER_TYPE_TO_WMO[String(v).toUpperCase()];
  return code === undefined ? null : code;
}

/**
 * Deterministic UUID (v5-style, SHA-1 over a fixed namespace) so re-running
 * the migration maps every origin row to the SAME destination uuid — that is
 * what makes inserts into tables without a natural unique key (lab_sessions,
 * conversations, training_plans…) idempotent via primary-key conflict, and
 * what lets cross-table references (matched_activity_id, session_id,
 * conversation_id, plan_id) be rewritten without keeping a lookup state.
 */
export function deterministicUuid(...parts: (string | number)[]): string {
  const hash = createHash("sha1")
    .update(["el-consejo-migration", ...parts].join(":"))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Drop the origin identity from raw JSONB copies. */
function stripClerkId<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const rest = { ...row };
  delete rest.clerk_id;
  return rest;
}

/* ------------------------------------------------------------------ */
/* Historical chat model (ports resolveChatLlm; the logic dies here)   */
/* ------------------------------------------------------------------ */

export const DEFAULT_CHAT_LLM = "deepseek";
export const LEGACY_DEFAULT_CHAT_LLM = "gemini";
export const DEFAULT_CHAT_LLM_SWITCHED_AT = "2026-08-08";

/**
 * conversations.model in Pulso is NULL unless the user explicitly chose a
 * model. The origin stored the app default of the day in every row, so a
 * stored llm_id equal to the default in force at its creation date was NOT a
 * choice → null. Anything else (including the old default re-picked after the
 * switch) was a choice and is preserved. Without a creation date we cannot
 * prove it was a default, so the stored value is respected (same stance as
 * the original resolveChatLlm: no date is no license to change the model).
 */
export function resolveHistoricalModel(
  llmId: string | null | undefined,
  createdAt: string | Date | null | undefined,
): string | null {
  if (!llmId) return null;
  const created = toDateStr(createdAt);
  if (!created) return llmId;
  const defaultAtCreation =
    created < DEFAULT_CHAT_LLM_SWITCHED_AT ? LEGACY_DEFAULT_CHAT_LLM : DEFAULT_CHAT_LLM;
  return llmId === defaultAtCreation ? null : llmId;
}

/* ------------------------------------------------------------------ */
/* Source row shapes (el-consejo biohacking-spec/02-database.md)       */
/* ------------------------------------------------------------------ */

type Num = number | string | null;
type Str = string | null;
type Dat = string | Date | null;

export interface SrcDailySummary extends Record<string, unknown> {
  date: Dat;
  steps: Num;
  distance_meters: Num;
  resting_hr: Num;
  min_hr: Num;
  max_hr: Num;
  avg_stress: Num;
  body_battery_high: Num;
  body_battery_low: Num;
  total_calories: Num;
  active_calories: Num;
  avg_respiration: Num;
  hrv_weekly_avg: Num;
  hrv_status: Str;
  floors_climbed: Num;
  floors_descended: Num;
  moderate_intensity_min: Num;
  vigorous_intensity_min: Num;
}

export interface SrcSleep extends Record<string, unknown> {
  date: Dat;
  sleep_seconds: Num;
  deep_sleep_seconds: Num;
  light_sleep_seconds: Num;
  rem_sleep_seconds: Num;
  awake_seconds: Num;
  sleep_score: Num;
}

export interface SrcBodyComposition extends Record<string, unknown> {
  date: Dat;
  weight_grams: Num;
  body_fat_pct: Num;
  muscle_mass_grams: Num;
  bmi: Num;
  body_water_pct: Num;
  bone_mass_grams: Num;
}

export interface SrcRawSummary {
  activityTrainingLoad?: number | string | null;
  trainingEffectLabel?: string | null;
  hrTimeInZone_1?: number | string | null;
  hrTimeInZone_2?: number | string | null;
  hrTimeInZone_3?: number | string | null;
  hrTimeInZone_4?: number | string | null;
  hrTimeInZone_5?: number | string | null;
  [k: string]: unknown;
}

export interface SrcActivity extends Record<string, unknown> {
  activity_id: number | string;
  date: Dat;
  calendar_date?: Dat;
  activity_type: Str;
  activity_name: Str;
  distance_meters: Num;
  duration_seconds: Num;
  avg_hr: Num;
  max_hr: Num;
  avg_speed: Num;
  max_speed: Num;
  calories: Num;
  steps: Num;
  vo2max_value: Num;
  training_effect: Num;
  avg_cadence: Num;
  elevation_gain: Num;
  elevation_loss: Num;
  aerobic_training_effect: Num;
  anaerobic_training_effect: Num;
  training_load: Num;
  avg_grade_adjusted_speed_mps: Num;
  moving_duration_seconds: Num;
  elapsed_duration_seconds: Num;
  start_time_local: Dat;
  start_time_gmt?: Dat;
  raw_summary: SrcRawSummary | null;
}

export interface SrcActivityLap extends Record<string, unknown> {
  activity_id: number | string;
  lap_index: Num;
  intensity_type: Str;
  distance_meters: Num;
  duration_seconds: Num;
  avg_hr: Num;
  max_hr: Num;
  avg_run_cadence_spm: Num;
  avg_power_w: Num;
  stride_length_cm: Num;
  vertical_oscillation_cm: Num;
  vertical_ratio: Num;
  ground_contact_time_ms: Num;
  elevation_gain_m: Num;
  elevation_loss_m: Num;
  min_elevation_m: Num;
  max_elevation_m: Num;
  start_latitude: Num;
  start_longitude: Num;
  end_latitude: Num;
  end_longitude: Num;
}

export interface SrcActivitySplit extends Record<string, unknown> {
  activity_id: number | string;
  split_index: Num;
  split_type: Str;
  distance_meters: Num;
  duration_seconds: Num;
  avg_hr: Num;
}

export interface SrcActivityWeather extends Record<string, unknown> {
  activity_id: number | string;
  temp: Num;
  apparent_temp: Num;
  dew_point: Num;
  relative_humidity: Num;
  wind_speed: Num;
  wind_direction_compass: Str;
  weather_type: Str;
  weather_station: Str;
}

export interface SrcSample extends Record<string, unknown> {
  timestamp_ms: number | string;
  value: Num;
}

export interface SrcLabSession extends Record<string, unknown> {
  id: number | string;
  sample_date: Dat;
  patient_name: Str;
  patient_dob: Str;
  patient_sex: Str;
  patient_age: Str;
  lab_name: Str;
  lab_location: Str;
  doctor_name: Str;
}

export interface SrcLabResult extends Record<string, unknown> {
  id: number | string;
  session_id: number | string;
  category: Str;
  test_name: Str;
  test_name_normalized: Str;
  result: Num;
  result_text: Str;
  unit: Str;
  reference_min: Num;
  reference_max: Num;
  reference_text: Str;
  is_flagged: boolean | null;
}

export interface SrcConversation extends Record<string, unknown> {
  id: number | string;
  title: Str;
  llm_id: Str;
  created_at: Dat;
  updated_at: Dat;
}

export interface SrcChatMessage extends Record<string, unknown> {
  conversation_id: number | string;
  role: string;
  content: string;
  action?: Str;
  created_at: Dat;
}

export interface SrcTrainingPlan extends Record<string, unknown> {
  id: number | string;
  name: string;
  goal_type: Str;
  goal_date: Dat;
  goal_time: Str;
  goal_distance_km: Num;
  available_days: Num;
  terrain: Str;
  plan_json: unknown;
  llm_used: Str;
  status: Str;
  created_at: Dat;
  updated_at: Dat;
}

export interface SrcPlanWorkout extends Record<string, unknown> {
  id: number | string;
  plan_id: number | string;
  week_number: Num;
  day_of_week: Num;
  date: Dat;
  workout_type: string;
  title: Str;
  target_distance_km: Num;
  target_pace_range: Str;
  target_hr_zone: Str;
  matched_activity_id: Num;
  status: Str;
  actual_distance_km: Num;
  actual_pace: Num;
}

export interface SrcPlanVersion extends Record<string, unknown> {
  id: number | string;
  plan_id: number | string;
  plan_json: unknown;
  label: Str;
  created_at: Dat;
}

export interface SrcTrainingSettings extends Record<string, unknown> {
  steps_goal_min: Num;
  steps_goal_max: Num;
  updated_at: Dat;
}

export interface SrcExerciseDefinition extends Record<string, unknown> {
  exercise_key: string;
  label: string;
  emoji: Str;
  color: Str;
  type: string;
  increment: Num;
  sort_order: Num;
  is_active: boolean | null;
  weekly_goal?: Num;
}

export interface SrcExerciseLog extends Record<string, unknown> {
  date: Dat;
  exercise: string;
  reps: Num;
}

export interface SrcExerciseSet extends Record<string, unknown> {
  date: Dat;
  exercise: string;
  set_number: Num;
  weight_kg: Num;
  reps: Num;
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

/** daily_summary → health_days (provider 'garmin'). */
export function mapDailySummary(row: SrcDailySummary, userId: string): HealthDayInsert {
  const date = toDateStr(row.date);
  if (!date) throw new Error("daily_summary row without date");
  const moderate = toInt(row.moderate_intensity_min);
  const vigorous = toInt(row.vigorous_intensity_min);
  // Garmin's combined intensity minutes: vigorous count double.
  const intensity =
    moderate === null && vigorous === null ? null : (moderate ?? 0) + 2 * (vigorous ?? 0);
  return {
    userId,
    date,
    provider: MIGRATION_PROVIDER,
    steps: toInt(row.steps),
    floors: toInt(row.floors_climbed),
    intensityMinutes: intensity,
    distanceM: toInt(row.distance_meters),
    caloriesTotal: toInt(row.total_calories),
    caloriesActive: toInt(row.active_calories),
    restingHr: toInt(row.resting_hr),
    hrMin: toInt(row.min_hr),
    hrMax: toInt(row.max_hr),
    stressAvg: toInt(row.avg_stress),
    stressMax: null,
    spo2Avg: null,
    respirationAvg: toNum(row.avg_respiration),
    hrvMs: toNum(row.hrv_weekly_avg),
    hrvStatus: row.hrv_status ?? null,
    hydrationMl: null,
    raw: stripClerkId(row),
  };
}

/**
 * sleep → sleep_sessions. The origin has per-date second totals but no
 * start/end instants; the session is anchored at local midnight of its date
 * and spans the in-bed time, which keeps startAt/endAt NOT NULL, deterministic
 * and inside the right night.
 */
export function mapSleep(row: SrcSleep, userId: string): SleepSessionInsert {
  const date = toDateStr(row.date);
  if (!date) throw new Error("sleep row without date");
  const totalMin = secondsToMin(row.sleep_seconds);
  const awakeMin = secondsToMin(row.awake_seconds);
  const inBedMin = totalMin === null && awakeMin === null ? null : (totalMin ?? 0) + (awakeMin ?? 0);
  const startAt = new Date(`${date}T00:00:00${SOURCE_UTC_OFFSET}`);
  const endAt = new Date(startAt.getTime() + (inBedMin ?? 0) * 60_000);
  return {
    userId,
    provider: MIGRATION_PROVIDER,
    externalId: date,
    startAt,
    endAt,
    totalMin,
    inBedMin,
    efficiency:
      totalMin !== null && inBedMin !== null && inBedMin > 0
        ? Math.round((totalMin / inBedMin) * 100)
        : null,
    deepMin: secondsToMin(row.deep_sleep_seconds),
    lightMin: secondsToMin(row.light_sleep_seconds),
    remMin: secondsToMin(row.rem_sleep_seconds),
    awakeMin,
    score: toInt(row.sleep_score),
    isNap: false,
    raw: stripClerkId(row),
  };
}

function secondsToMin(v: Num): number | null {
  const n = toNum(v);
  return n === null ? null : Math.round(n / 60);
}

/** body_composition → body_measurements (origin masses are in GRAMS). */
export function mapBodyComposition(row: SrcBodyComposition, userId: string): BodyMeasurementInsert {
  const date = toDateStr(row.date);
  if (!date) throw new Error("body_composition row without date");
  return {
    userId,
    provider: MIGRATION_PROVIDER,
    // No time-of-day at origin: noon UTC = 06:00 CDMX, morning weigh-in.
    measuredAt: new Date(`${date}T12:00:00Z`),
    weightKg: gramsToKg(row.weight_grams),
    bmi: toNum(row.bmi),
    bodyFatPct: toNum(row.body_fat_pct),
    muscleMassKg: gramsToKg(row.muscle_mass_grams),
    bodyWaterPct: toNum(row.body_water_pct),
    boneMassKg: gramsToKg(row.bone_mass_grams),
    raw: stripClerkId(row),
  };
}

/** activities → workouts. externalId = String(activity_id); id deterministic. */
export function mapActivity(row: SrcActivity, userId: string): WorkoutInsert {
  const externalId = String(row.activity_id);
  const rs: SrcRawSummary = row.raw_summary ?? {};
  const teLabel = rs.trainingEffectLabel;
  return {
    id: deterministicUuid("activities", externalId),
    userId,
    provider: MIGRATION_PROVIDER,
    externalId,
    sport: row.activity_type ?? "unknown",
    name: row.activity_name ?? null,
    startAt: activityStartAt(row),
    durationS: toInt(row.duration_seconds) ?? toInt(row.elapsed_duration_seconds) ?? 0,
    movingS: toInt(row.moving_duration_seconds),
    distanceM: toNum(row.distance_meters),
    calories: toInt(row.calories),
    hrAvg: toInt(row.avg_hr),
    hrMax: toInt(row.max_hr),
    hrMin: null,
    elevationGainM: toNum(row.elevation_gain),
    elevationLossM: toNum(row.elevation_loss),
    cadenceAvg: toNum(row.avg_cadence),
    speedAvgMps: toNum(row.avg_speed),
    speedMaxMps: toNum(row.max_speed),
    powerAvgW: null,
    powerMaxW: null,
    aerobicTe: toNum(row.aerobic_training_effect),
    anaerobicTe: toNum(row.anaerobic_training_effect),
    // Same precedence as the original extractEffortMetrics: raw_summary wins.
    trainingLoad: toNum(rs.activityTrainingLoad) ?? toNum(row.training_load),
    teLabel: teLabel === null || teLabel === undefined || teLabel === "" ? null : String(teLabel),
    gapMps: toNum(row.avg_grade_adjusted_speed_mps),
    vo2max: toNum(row.vo2max_value),
    detailSource: null,
    raw: stripClerkId(row),
  };
}

/**
 * start_time_gmt is a real instant when present; start_time_local is a
 * naive timestamp pinned to CDMX; last resort is noon UTC of the date.
 */
function activityStartAt(row: SrcActivity): Date {
  const gmt = toInstant(row.start_time_gmt ?? null);
  if (gmt) return gmt;
  const local = row.start_time_local;
  if (typeof local === "string" && local.length >= 19) {
    const pinned = toInstant(`${local.slice(0, 19)}${SOURCE_UTC_OFFSET}`);
    if (pinned) return pinned;
  } else if (local instanceof Date && !Number.isNaN(local.getTime())) {
    return local;
  }
  const date = toDateStr(row.date) ?? toDateStr(row.calendar_date ?? null);
  if (!date) throw new Error(`activity ${row.activity_id} has no usable start time`);
  return new Date(`${date}T12:00:00Z`);
}

/** raw_summary.hrTimeInZone_1..5 → workout_hr_zones rows (seconds per zone). */
export function extractHrZones(rs: SrcRawSummary | null): { zone: number; seconds: number }[] {
  if (!rs) return [];
  const zones: { zone: number; seconds: number }[] = [];
  for (let z = 1; z <= 5; z++) {
    const seconds = toNum(rs[`hrTimeInZone_${z}`]);
    if (seconds !== null) zones.push({ zone: z, seconds: Math.round(seconds) });
  }
  return zones;
}

/** (0,0) is the origin's null coordinate (DDL doc §2.6). */
function coord(lat: Num, lng: Num): { lat: number | null; lng: number | null } {
  const la = toNum(lat);
  const ln = toNum(lng);
  if (la === null || ln === null || (la === 0 && ln === 0)) return { lat: null, lng: null };
  return { lat: la, lng: ln };
}

/** activity_laps → workout_laps (kind 'lap'); workoutId is joined by the script. */
export function mapActivityLap(row: SrcActivityLap): Omit<WorkoutLapInsert, "workoutId"> {
  const start = coord(row.start_latitude, row.start_longitude);
  const end = coord(row.end_latitude, row.end_longitude);
  return {
    kind: "lap",
    lapIndex: toInt(row.lap_index) ?? 0,
    intensityType: row.intensity_type ?? null,
    startAt: null,
    durationS: toNum(row.duration_seconds),
    distanceM: toNum(row.distance_meters),
    hrAvg: toInt(row.avg_hr),
    hrMax: toInt(row.max_hr),
    speedAvgMps: null,
    cadenceAvg: toNum(row.avg_run_cadence_spm),
    powerAvgW: toNum(row.avg_power_w),
    strideLengthCm: toNum(row.stride_length_cm),
    verticalOscillationCm: toNum(row.vertical_oscillation_cm),
    verticalRatio: toNum(row.vertical_ratio),
    groundContactTimeMs: toNum(row.ground_contact_time_ms),
    elevationGainM: toNum(row.elevation_gain_m),
    elevationLossM: toNum(row.elevation_loss_m),
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng,
    raw: stripClerkId(row),
  };
}

/** activity_typed_splits → workout_laps (kind 'split'; split_type → intensityType). */
export function mapActivitySplit(row: SrcActivitySplit): Omit<WorkoutLapInsert, "workoutId"> {
  return {
    kind: "split",
    lapIndex: toInt(row.split_index) ?? 0,
    intensityType: row.split_type ?? null,
    startAt: null,
    durationS: toNum(row.duration_seconds),
    distanceM: toNum(row.distance_meters),
    hrAvg: toInt(row.avg_hr),
    hrMax: null,
    speedAvgMps: null,
    cadenceAvg: null,
    powerAvgW: null,
    strideLengthCm: null,
    verticalOscillationCm: null,
    verticalRatio: null,
    groundContactTimeMs: null,
    elevationGainM: null,
    elevationLossM: null,
    startLat: null,
    startLng: null,
    endLat: null,
    endLng: null,
    raw: stripClerkId(row),
  };
}

/**
 * activity_weather → workout_weather. °F→°C for the three temperatures,
 * mph→m/s for wind, 16-point compass → degrees, weather_type → nearest WMO
 * code. weather_station has no destination column and is dropped.
 */
export function mapActivityWeather(row: SrcActivityWeather): Omit<WorkoutWeatherInsert, "workoutId"> {
  return {
    tempC: fToC(row.temp),
    apparentTempC: fToC(row.apparent_temp),
    dewPointC: fToC(row.dew_point),
    relativeHumidity: toNum(row.relative_humidity),
    windSpeedMs: mphToMs(row.wind_speed),
    windDirectionDeg: compassToDeg(row.wind_direction_compass),
    weatherCode: weatherTypeToWmo(row.weather_type),
    source: MIGRATION_PROVIDER,
  };
}

export type SampleMetric = "hr" | "body_battery" | "stress";

/** {heart_rate,body_battery,stress}_samples → metric_samples (epoch ms → Date). */
export function mapMetricSample(
  metric: SampleMetric,
  row: SrcSample,
  userId: string,
): MetricSampleInsert | null {
  const value = toNum(row.value);
  const ms = toNum(row.timestamp_ms);
  if (value === null || ms === null) return null;
  return {
    userId,
    metric,
    recordedAt: new Date(ms),
    value,
    provider: MIGRATION_PROVIDER,
  };
}

/** lab_sessions → lab_sessions (deterministic id keyed on the origin id). */
export function mapLabSession(row: SrcLabSession, userId: string): LabSessionInsert {
  return {
    id: deterministicUuid("lab_sessions", String(row.id)),
    userId,
    sampleDate: toDateStr(row.sample_date),
    labName: row.lab_name ?? null,
    labLocation: row.lab_location ?? null,
    patientName: row.patient_name ?? null,
    patientDob: row.patient_dob ?? null,
    patientSex: row.patient_sex ?? null,
    patientAge: row.patient_age ?? null,
    doctorName: row.doctor_name ?? null,
    status: "completed",
  };
}

/** lab_results → lab_results (origin rows have no clerk_id; owner comes via session). */
export function mapLabResult(row: SrcLabResult, userId: string): LabResultInsert {
  return {
    id: deterministicUuid("lab_results", String(row.id)),
    sessionId: deterministicUuid("lab_sessions", String(row.session_id)),
    userId,
    category: row.category ?? "Otros Marcadores",
    testName: row.test_name ?? "",
    testNameNormalized: row.test_name_normalized ?? null,
    valueNum: toNum(row.result),
    valueText: row.result_text ?? null,
    unit: row.unit ?? null,
    refLow: toNum(row.reference_min),
    refHigh: toNum(row.reference_max),
    refText: row.reference_text ?? null,
    isFlagged: row.is_flagged ?? false,
  };
}

export type ConversationKind = "coach" | "planner";

const CONVERSATION_NS: Record<ConversationKind, string> = {
  coach: "coach_conversations",
  planner: "training_planner_conversations",
};

/** coach_/training_planner_conversations → conversations (model per historical default). */
export function mapConversation(
  kind: ConversationKind,
  row: SrcConversation,
  userId: string,
): ConversationInsert {
  return {
    id: deterministicUuid(CONVERSATION_NS[kind], String(row.id)),
    userId,
    kind,
    title: row.title ?? null,
    model: resolveHistoricalModel(row.llm_id, row.created_at),
    planId: null,
    createdAt: toInstant(row.created_at) ?? undefined,
    updatedAt: toInstant(row.updated_at) ?? undefined,
  };
}

/** coach_/training_planner_messages → messages (id is identity; conversation rewritten). */
export function mapChatMessage(kind: ConversationKind, row: SrcChatMessage): Omit<MessageInsert, "id"> {
  return {
    conversationId: deterministicUuid(CONVERSATION_NS[kind], String(row.conversation_id)),
    role: row.role,
    content: row.content,
    action: row.action ?? null,
    model: null,
    createdAt: toInstant(row.created_at) ?? undefined,
  };
}

/** training_plans → training_plans (plan_json intact). */
export function mapTrainingPlan(row: SrcTrainingPlan, userId: string): TrainingPlanInsert {
  return {
    id: deterministicUuid("training_plans", String(row.id)),
    userId,
    name: row.name,
    goalType: row.goal_type ?? null,
    goalDate: toDateStr(row.goal_date),
    goalTime: row.goal_time ?? null,
    goalDistanceKm: toNum(row.goal_distance_km),
    // Origin stores a day count (integer); the jsonb column keeps it as-is.
    availableDays: toNum(row.available_days),
    terrain: row.terrain ?? null,
    planJson: row.plan_json ?? {},
    llmUsed: row.llm_used ?? null,
    status: row.status ?? "active",
    createdAt: toInstant(row.created_at) ?? undefined,
    updatedAt: toInstant(row.updated_at) ?? undefined,
  };
}

/**
 * training_plan_workouts → training_plan_workouts. Origin status 'planned'
 * becomes the destination's 'pending' vocabulary (its column default);
 * completed/skipped pass through. matched_activity_id (Garmin bigint) is
 * rewritten to the deterministic workout uuid, but only when that workout was
 * actually inserted/found — the script passes the known set to avoid dangling
 * FKs.
 */
export function mapPlanWorkout(
  row: SrcPlanWorkout,
  userId: string,
  knownWorkoutIdByExternalId: ReadonlyMap<string, string>,
): TrainingPlanWorkoutInsert {
  const matched = row.matched_activity_id === null ? null : String(row.matched_activity_id);
  const actualPace = toNum(row.actual_pace);
  return {
    id: deterministicUuid("training_plan_workouts", String(row.id)),
    planId: deterministicUuid("training_plans", String(row.plan_id)),
    userId,
    weekNumber: toInt(row.week_number) ?? 0,
    dayOfWeek: toInt(row.day_of_week) ?? 0,
    date: toDateStr(row.date),
    workoutType: row.workout_type,
    title: row.title ?? null,
    targetDistanceKm: toNum(row.target_distance_km),
    targetPaceRange: row.target_pace_range ?? null,
    targetHrZone: row.target_hr_zone ?? null,
    matchedWorkoutId: matched !== null ? (knownWorkoutIdByExternalId.get(matched) ?? null) : null,
    matchedManualId: null,
    status: row.status === "planned" || !row.status ? "pending" : row.status,
    actualDistanceKm: toNum(row.actual_distance_km),
    actualPace: actualPace === null ? null : String(actualPace),
  };
}

/** training_plan_versions → training_plan_versions. */
export function mapPlanVersion(row: SrcPlanVersion, userId: string): TrainingPlanVersionInsert {
  return {
    id: deterministicUuid("training_plan_versions", String(row.id)),
    planId: deterministicUuid("training_plans", String(row.plan_id)),
    userId,
    planJson: row.plan_json ?? {},
    label: row.label ?? null,
    createdAt: toInstant(row.created_at) ?? undefined,
  };
}

/** training_settings → training_settings (PK userId). */
export function mapTrainingSettings(row: SrcTrainingSettings, userId: string): TrainingSettingsInsert {
  return {
    userId,
    stepsGoalMin: toInt(row.steps_goal_min) ?? 150000,
    stepsGoalMax: toInt(row.steps_goal_max) ?? 200000,
    updatedAt: toInstant(row.updated_at) ?? undefined,
  };
}

/** exercise_definitions → exercise_definitions. */
export function mapExerciseDefinition(
  row: SrcExerciseDefinition,
  userId: string,
): ExerciseDefinitionInsert {
  return {
    userId,
    exerciseKey: row.exercise_key,
    label: row.label,
    emoji: row.emoji ?? null,
    color: row.color ?? null,
    type: row.type,
    increment: toInt(row.increment),
    weeklyGoal: toInt(row.weekly_goal ?? null),
    isActive: row.is_active ?? true,
    sortOrder: toInt(row.sort_order) ?? 0,
  };
}

/** exercise_logs → exercise_logs (origin column `exercise` → exerciseKey). */
export function mapExerciseLog(row: SrcExerciseLog, userId: string): ExerciseLogInsert {
  const date = toDateStr(row.date);
  if (!date) throw new Error("exercise_logs row without date");
  return {
    userId,
    date,
    exerciseKey: row.exercise,
    reps: toInt(row.reps) ?? 0,
  };
}

/** exercise_sets → exercise_sets (origin column `exercise` → exerciseKey). */
export function mapExerciseSet(row: SrcExerciseSet, userId: string): ExerciseSetInsert {
  const date = toDateStr(row.date);
  if (!date) throw new Error("exercise_sets row without date");
  return {
    userId,
    date,
    exerciseKey: row.exercise,
    setNumber: toInt(row.set_number) ?? 0,
    weightKg: toNum(row.weight_kg),
    reps: toInt(row.reps) ?? 0,
  };
}
