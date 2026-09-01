/**
 * Pure mappers: OW responses → Pulso canonical row shapes (spec docs 02/03).
 *
 * Canonical units are meters, seconds, °C, kg, ml, ms — conversion happens
 * HERE (once, at ingestion) via lib/health/units, never in render code. Every
 * row keeps `provider` and the raw OW payload (JSONB passthrough policy).
 *
 * The output shapes structurally match the Drizzle insert shapes of
 * lib/db/schema.ts, but are declared locally: lib/ow must not import feature
 * or db modules (isolation contract, doc 03).
 */
import { paceSecPerKmToMps, secondsToMinutes } from "@/lib/health/units";
import type {
  OwActivitySummary,
  OwBodySummary,
  OwHealthScore,
  OwRecoverySummary,
  OwSleepSession,
  OwSleepSummary,
  OwTimeSeriesSample,
  OwWorkout,
} from "@/lib/ow/schemas";

// ---------------------------------------------------------------------------
// Canonical row shapes (match lib/db/schema.ts inserts structurally)
// ---------------------------------------------------------------------------

export interface NormalizedHealthDay {
  userId: string;
  date: string;
  provider: string;
  steps: number | null;
  floors: number | null;
  intensityMinutes: number | null;
  distanceM: number | null;
  caloriesTotal: number | null;
  caloriesActive: number | null;
  restingHr: number | null;
  hrMin: number | null;
  hrMax: number | null;
  stressAvg: number | null;
  stressMax: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  spo2Avg: number | null;
  respirationAvg: number | null;
  hrvMs: number | null;
  hrvStatus: string | null;
  hydrationMl: number | null;
  raw: unknown;
}

export interface NormalizedSleepSession {
  userId: string;
  provider: string;
  externalId: string;
  startAt: Date;
  endAt: Date;
  totalMin: number | null;
  inBedMin: number | null;
  efficiency: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  score: number | null;
  isNap: boolean;
  raw: unknown;
}

export interface NormalizedWorkout {
  userId: string;
  provider: string;
  externalId: string;
  sport: string;
  name: string | null;
  startAt: Date;
  durationS: number;
  movingS: number | null;
  distanceM: number | null;
  calories: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  hrMin: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  cadenceAvg: number | null;
  speedAvgMps: number | null;
  speedMaxMps: number | null;
  powerAvgW: number | null;
  powerMaxW: number | null;
  raw: unknown;
}

export interface NormalizedBodyMeasurement {
  userId: string;
  provider: string;
  measuredAt: Date;
  weightKg: number | null;
  bmi: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  bodyWaterPct: number | null;
  boneMassKg: number | null;
  raw: unknown;
}

export type CanonicalMetric = "hr" | "stress" | "body_battery" | "spo2" | "respiration";

export interface NormalizedMetricSample {
  userId: string;
  metric: CanonicalMetric;
  recordedAt: Date;
  value: number;
  provider: string;
}

export interface NormalizedProviderScores {
  userId: string;
  date: string;
  provider: string;
  scores: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value);
}

function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/**
 * Calendar date ("YYYY-MM-DD") of an instant in its local zone. `zoneOffset`
 * is OW's "+HH:MM" string; without it the UTC date is used.
 */
export function localDateOf(isoInstant: string, zoneOffset?: string | null): string {
  const utcMs = Date.parse(isoInstant);
  let offsetMs = 0;
  const match = zoneOffset?.match(/^([+-])(\d{2}):(\d{2})$/);
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    offsetMs = sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  }
  return new Date(utcMs + offsetMs).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/**
 * OW daily summaries → `health_days` row. The activity summary drives the
 * row; same-day sleep/recovery summaries (when available) fill the vitals the
 * activity summary does not carry. Stress and body battery are intentionally
 * left null here — they arrive as timeseries (normalizeMetricSamples) and are
 * aggregated by the ingestion job.
 */
export function normalizeHealthDay(
  userId: string,
  activity: OwActivitySummary,
  extras: { sleep?: OwSleepSummary; recovery?: OwRecoverySummary } = {},
): NormalizedHealthDay {
  const { sleep, recovery } = extras;
  const intensity = activity.intensity_minutes;
  // WHO/Garmin convention: vigorous minutes count double toward the total.
  const intensityMinutes =
    intensity && (intensity.moderate != null || intensity.vigorous != null)
      ? (intensity.moderate ?? 0) + 2 * (intensity.vigorous ?? 0)
      : null;
  return {
    userId,
    date: activity.date,
    provider: activity.source.provider,
    steps: orNull(activity.steps),
    floors: orNull(activity.floors_climbed),
    intensityMinutes,
    distanceM: round(activity.distance_meters),
    caloriesTotal: round(activity.total_calories_kcal),
    caloriesActive: round(activity.active_calories_kcal),
    restingHr: orNull(recovery?.resting_heart_rate_bpm),
    hrMin: orNull(activity.heart_rate?.min_bpm),
    hrMax: orNull(activity.heart_rate?.max_bpm),
    stressAvg: null,
    stressMax: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    spo2Avg: orNull(sleep?.avg_spo2_percent ?? recovery?.avg_spo2_percent),
    respirationAvg: orNull(sleep?.avg_respiratory_rate),
    hrvMs: orNull(
      sleep?.avg_hrv_rmssd_ms ??
        recovery?.avg_hrv_rmssd_ms ??
        sleep?.avg_hrv_sdnn_ms ??
        recovery?.avg_hrv_sdnn_ms,
    ),
    hrvStatus: null,
    hydrationMl: null,
    raw: { activity, sleep: sleep ?? null, recovery: recovery ?? null },
  };
}

/** OW sleep session → `sleep_sessions` row. Score arrives via health scores, not here. */
export function normalizeSleepSession(userId: string, session: OwSleepSession): NormalizedSleepSession {
  const asleepSeconds = session.sleep_duration_seconds ?? session.duration_seconds;
  return {
    userId,
    provider: session.source.provider,
    externalId: session.id,
    startAt: new Date(session.start_time),
    endAt: new Date(session.end_time),
    totalMin: round(secondsToMinutes(asleepSeconds)),
    inBedMin: round(secondsToMinutes(session.duration_seconds)),
    efficiency: orNull(session.efficiency_percent),
    deepMin: orNull(session.stages?.deep_minutes),
    lightMin: orNull(session.stages?.light_minutes),
    remMin: orNull(session.stages?.rem_minutes),
    awakeMin: orNull(session.stages?.awake_minutes),
    score: null,
    isNap: session.is_nap,
    raw: session,
  };
}

/**
 * OW workout → `workouts` row. Sport passes through OW's normalized taxonomy.
 * OW reports pace (sec/km); canonical stores speed (m/s). Fields OW does not
 * expose (moving time, power, cadence, TE/load) stay null — the FIT enricher
 * fills them (doc 03 gaps).
 */
export function normalizeWorkout(userId: string, workout: OwWorkout): NormalizedWorkout {
  const durationS =
    workout.duration_seconds ??
    Math.max(0, Math.round((Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 1000));
  const pace = workout.avg_pace_sec_per_km;
  return {
    userId,
    provider: workout.source.provider,
    externalId: workout.id,
    sport: workout.type,
    name: orNull(workout.name),
    startAt: new Date(workout.start_time),
    durationS,
    movingS: null,
    distanceM: orNull(workout.distance_meters),
    calories: round(workout.calories_kcal),
    hrAvg: orNull(workout.avg_heart_rate_bpm),
    hrMax: orNull(workout.max_heart_rate_bpm),
    hrMin: null,
    elevationGainM: orNull(workout.elevation_gain_meters),
    elevationLossM: null,
    cadenceAvg: null,
    speedAvgMps: pace != null && pace > 0 ? paceSecPerKmToMps(pace) : null,
    speedMaxMps: null,
    powerAvgW: null,
    powerMaxW: null,
    raw: workout,
  };
}

/**
 * OW body summary snapshot → `body_measurements` row, or null when the
 * snapshot carries no body-composition data. OW already reports kg/percent
 * (canonical); water and bone mass are not exposed by OW today.
 */
export function normalizeBodyMeasurement(
  userId: string,
  body: OwBodySummary,
  measuredAt: Date | string,
): NormalizedBodyMeasurement | null {
  const s = body.slow_changing;
  if (s.weight_kg == null && s.bmi == null && s.body_fat_percent == null && s.muscle_mass_kg == null) {
    return null;
  }
  return {
    userId,
    provider: body.source.provider,
    measuredAt: measuredAt instanceof Date ? measuredAt : new Date(measuredAt),
    weightKg: orNull(s.weight_kg),
    bmi: orNull(s.bmi),
    bodyFatPct: orNull(s.body_fat_percent),
    muscleMassKg: orNull(s.muscle_mass_kg),
    bodyWaterPct: null,
    boneMassKg: null,
    raw: body,
  };
}

/** OW SeriesType slug → canonical `metric_samples.metric`. */
const SERIES_TYPE_TO_METRIC: Record<string, CanonicalMetric> = {
  heart_rate: "hr",
  garmin_stress_level: "stress",
  garmin_body_battery: "body_battery",
  oxygen_saturation: "spo2",
  respiratory_rate: "respiration",
};

/**
 * OW timeseries samples → `metric_samples` rows. Samples whose series type has
 * no canonical metric are dropped (they are not lost — the ingestion job only
 * requests the mapped types, and raw series stay in OW).
 */
export function normalizeMetricSamples(
  userId: string,
  samples: ReadonlyArray<OwTimeSeriesSample>,
): NormalizedMetricSample[] {
  const out: NormalizedMetricSample[] = [];
  for (const sample of samples) {
    const metric = SERIES_TYPE_TO_METRIC[sample.type];
    if (!metric) continue;
    out.push({
      userId,
      metric,
      recordedAt: new Date(sample.timestamp),
      value: sample.value,
      provider: sample.source?.provider ?? "unknown",
    });
  }
  return out;
}

/**
 * OW health scores → `provider_scores` rows: one row per (local date,
 * provider), with the day's scores keyed by category inside the JSONB. Scores
 * OW computes itself (provider null upstream) are stored under provider "ow".
 */
export function normalizeProviderScores(
  userId: string,
  scores: ReadonlyArray<OwHealthScore>,
): NormalizedProviderScores[] {
  const byKey = new Map<string, NormalizedProviderScores>();
  for (const score of scores) {
    const provider = score.provider ?? "ow";
    const date = localDateOf(score.recorded_at, score.zone_offset);
    const key = `${date} ${provider}`;
    let row = byKey.get(key);
    if (!row) {
      row = { userId, date, provider, scores: {} };
      byKey.set(key, row);
    }
    row.scores[score.category] = {
      value: score.value ?? null,
      qualifier: score.qualifier ?? null,
      components: score.components ?? null,
      recorded_at: score.recorded_at,
      event_record_id: score.event_record_id ?? null,
    };
  }
  return [...byKey.values()];
}
