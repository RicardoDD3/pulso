/**
 * Zod schemas for the Open Wearables (OW) responses Pulso consumes.
 *
 * These are the ingestion contract (spec doc 03): every OW response is parsed
 * against them before it touches the canonical tables, and the contract tests
 * validate the recorded fixtures against them. Field names are grounded in the
 * OW backend source (the-momentum/open-wearables @ main, 2026-09):
 *
 * - users:        backend/app/schemas/model_crud/user_management/user.py
 * - connections:  backend/app/schemas/model_crud/user_management/user_connection.py
 * - oauth:        backend/app/schemas/model_crud/credentials/oauth.py
 * - events:       backend/app/schemas/responses/activity/events.py
 * - timeseries:   backend/app/schemas/responses/activity/data_point_responses.py
 * - summaries:    backend/app/schemas/responses/activity/summaries.py
 * - scores:       backend/app/schemas/model_crud/activities/health_score.py
 * - pagination:   backend/app/schemas/utils/pagination.py + utils/metadata.py
 * - webhooks:     backend/app/schemas/webhooks/{endpoints,event_types}.py and
 *                 backend/app/services/outgoing_webhooks/events.py
 *
 * OW is pre-1.0; unknown keys are ignored (zod strips them) and anything the
 * source marks `| None` is `.nullish()` here so schema drift fails loudly only
 * when a field Pulso actually relies on changes shape.
 */
import { z } from "zod";

/** ISO 8601 timestamp; OW emits both offset-aware and naive datetimes. */
const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "expected an ISO 8601 datetime",
});

/** Calendar date, YYYY-MM-DD. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared envelopes
// ---------------------------------------------------------------------------

/** utils/metadata.py SourceMetadata — provenance attached to every record. */
export const sourceMetadataSchema = z.object({
  provider: z.string(),
  source: z.string().nullish(),
  device: z.string().nullish(),
  device_type: z.string().nullish(),
  device_name: z.string().nullish(), // computed_field, serialized by pydantic
});

/** utils/pagination.py Pagination (cursor style). */
export const paginationSchema = z.object({
  next_cursor: z.string().nullish(),
  previous_cursor: z.string().nullish(),
  has_more: z.boolean(),
  total_count: z.number().int().nullish(),
});

/** utils/metadata.py TimeseriesMetadata. */
export const timeseriesMetadataSchema = z.object({
  resolution: z.enum(["raw", "1min", "5min", "15min", "1hour"]).nullish(),
  sample_count: z.number().int().nullish(),
  start_time: isoDateTime.nullish(),
  end_time: isoDateTime.nullish(),
});

/** utils/pagination.py PaginatedResponse[T] — { data, pagination, metadata }. */
export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: paginationSchema,
    metadata: timeseriesMetadataSchema,
  });
}

/** utils/pagination.py OldPaginatedResponse[T] — page/limit style (GET /users). */
export function oldPaginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    // computed_field properties, serialized by pydantic
    pages: z.number().int().nullish(),
    has_next: z.boolean().nullish(),
    has_prev: z.boolean().nullish(),
  });
}

// ---------------------------------------------------------------------------
// Users (routes/v1/users.py + user.py)
// ---------------------------------------------------------------------------

export const owUserSchema = z.object({
  id: uuid,
  created_at: isoDateTime,
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  email: z.string().nullish(),
  external_user_id: z.string().nullish(),
  last_synced_at: isoDateTime.nullish(),
  last_synced_provider: z.string().nullish(),
  has_active_connection: z.boolean().default(false),
});
export type OwUser = z.infer<typeof owUserSchema>;

export const owUserListSchema = oldPaginatedResponseSchema(owUserSchema);

// ---------------------------------------------------------------------------
// Connections (routes/v1/connections.py + user_connection.py)
// ---------------------------------------------------------------------------

/** auth/connection_status.py ConnectionStatus. */
export const owConnectionStatusSchema = z.enum(["active", "revoked", "expired"]);

/** UserConnectionWithCapabilities — GET /users/{id}/connections returns a plain array. */
export const owConnectionSchema = z.object({
  id: uuid,
  user_id: uuid,
  provider: z.string(),
  provider_user_id: z.string().nullish(),
  provider_username: z.string().nullish(),
  scope: z.string().nullish(),
  status: owConnectionStatusSchema,
  last_synced_at: isoDateTime.nullish(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  // capability enrichment (populated by the endpoint, not the ORM)
  icon_url: z.string().nullish(),
  max_historical_days: z.number().int().nullish(),
  rest_pull: z.boolean().default(false),
  webhook_stream: z.boolean().default(false),
  webhook_ping: z.boolean().default(false),
  webhook_callback: z.boolean().default(false),
  live_sync_mode: z.enum(["pull", "webhook"]).nullish(),
  linked_user_ids: z.array(uuid).default([]),
});
export type OwConnection = z.infer<typeof owConnectionSchema>;

export const owConnectionListSchema = z.array(owConnectionSchema);

/** credentials/oauth.py AuthorizationURLResponse — GET /oauth/{provider}/authorize. */
export const owAuthorizationUrlSchema = z.object({
  authorization_url: z.string(),
  state: z.string(),
});
export type OwAuthorizationUrl = z.infer<typeof owAuthorizationUrlSchema>;

// ---------------------------------------------------------------------------
// Events (routes/v1/events.py + responses/activity/events.py)
// ---------------------------------------------------------------------------

/** responses/activity/data_point_responses.py TimeSeriesSample. */
export const owTimeSeriesSampleSchema = z.object({
  timestamp: isoDateTime,
  zone_offset: z.string().nullish(),
  type: z.string(), // SeriesType slug (enums/series_types.py, ~100 values)
  value: z.number(),
  unit: z.string(),
  source: sourceMetadataSchema.nullish(),
  is_daily_total: z.boolean().nullish(),
});
export type OwTimeSeriesSample = z.infer<typeof owTimeSeriesSampleSchema>;

export const owTimeseriesPageSchema = paginatedResponseSchema(owTimeSeriesSampleSchema);

/** responses/activity/events.py Workout (+ WorkoutDetailed's heart_rate_samples). */
export const owWorkoutSchema = z.object({
  id: uuid,
  type: z.string(), // OW-normalized sport slug (enums/workout_types.py)
  name: z.string().nullish(),
  start_time: isoDateTime,
  end_time: isoDateTime,
  zone_offset: z.string().nullish(),
  duration_seconds: z.number().int().nullish(),
  source: sourceMetadataSchema,
  calories_kcal: z.number().nullish(),
  distance_meters: z.number().nullish(),
  avg_heart_rate_bpm: z.number().int().nullish(),
  max_heart_rate_bpm: z.number().int().nullish(),
  avg_pace_sec_per_km: z.number().nullish(),
  elevation_gain_meters: z.number().nullish(),
  heart_rate_samples: z.array(owTimeSeriesSampleSchema).nullish(), // WorkoutDetailed only
});
export type OwWorkout = z.infer<typeof owWorkoutSchema>;

export const owWorkoutsPageSchema = paginatedResponseSchema(owWorkoutSchema);

/** summaries.py SleepStagesSummary. */
export const owSleepStagesSchema = z.object({
  awake_minutes: z.number().int().nullish(),
  light_minutes: z.number().int().nullish(),
  deep_minutes: z.number().int().nullish(),
  rem_minutes: z.number().int().nullish(),
});

/** model_crud/activities/sleep.py SleepStage (constants/sleep.py SleepStageType). */
export const owSleepStageIntervalSchema = z.object({
  stage: z.enum(["in_bed", "awake", "sleeping", "light", "deep", "rem", "unknown"]),
  start_time: isoDateTime,
  end_time: isoDateTime,
});

/** responses/activity/events.py SleepSession. */
export const owSleepSessionSchema = z.object({
  id: uuid,
  start_time: isoDateTime,
  end_time: isoDateTime,
  zone_offset: z.string().nullish(),
  source: sourceMetadataSchema,
  duration_seconds: z.number().int(),
  sleep_duration_seconds: z.number().int().nullish(),
  efficiency_percent: z.number().nullish(),
  stages: owSleepStagesSchema.nullish(),
  sleep_stage_intervals: z.array(owSleepStageIntervalSchema).nullish(),
  is_nap: z.boolean().default(false),
});
export type OwSleepSession = z.infer<typeof owSleepSessionSchema>;

export const owSleepSessionsPageSchema = paginatedResponseSchema(owSleepSessionSchema);

// ---------------------------------------------------------------------------
// Daily summaries (routes/v1/summaries.py + responses/activity/summaries.py)
// ---------------------------------------------------------------------------

export const owActivitySummarySchema = z.object({
  date: isoDate,
  source: sourceMetadataSchema,
  steps: z.number().int().nullish(),
  distance_meters: z.number().nullish(),
  floors_climbed: z.number().int().nullish(),
  elevation_meters: z.number().nullish(),
  active_calories_kcal: z.number().nullish(),
  total_calories_kcal: z.number().nullish(),
  active_minutes: z.number().int().nullish(),
  sedentary_minutes: z.number().int().nullish(),
  intensity_minutes: z
    .object({
      light: z.number().int().nullish(),
      moderate: z.number().int().nullish(),
      vigorous: z.number().int().nullish(),
    })
    .nullish(),
  heart_rate: z
    .object({
      avg_bpm: z.number().int().nullish(),
      max_bpm: z.number().int().nullish(),
      min_bpm: z.number().int().nullish(),
    })
    .nullish(),
});
export type OwActivitySummary = z.infer<typeof owActivitySummarySchema>;

export const owActivitySummariesPageSchema = paginatedResponseSchema(owActivitySummarySchema);

export const owSleepSummarySchema = z.object({
  date: isoDate,
  source: sourceMetadataSchema,
  start_time: isoDateTime.nullish(),
  end_time: isoDateTime.nullish(),
  zone_offset: z.string().nullish(),
  duration_minutes: z.number().int().nullish(),
  total_duration_minutes: z.number().int().nullish(),
  time_in_bed_minutes: z.number().int().nullish(),
  efficiency_percent: z.number().nullish(),
  stages: owSleepStagesSchema.nullish(),
  interruptions_count: z.number().int().nullish(),
  nap_count: z.number().int().nullish(),
  nap_duration_minutes: z.number().int().nullish(),
  sessions: z
    .array(
      z.object({
        start_time: isoDateTime,
        end_time: isoDateTime,
        zone_offset: z.string().nullish(),
        duration_minutes: z.number().int().nullish(),
        is_nap: z.boolean().default(false),
      }),
    )
    .nullish(),
  avg_heart_rate_bpm: z.number().int().nullish(),
  avg_hrv_sdnn_ms: z.number().nullish(),
  avg_hrv_rmssd_ms: z.number().nullish(),
  avg_respiratory_rate: z.number().nullish(),
  avg_spo2_percent: z.number().nullish(),
});
export type OwSleepSummary = z.infer<typeof owSleepSummarySchema>;

export const owSleepSummariesPageSchema = paginatedResponseSchema(owSleepSummarySchema);

export const owRecoverySummarySchema = z.object({
  date: isoDate,
  source: sourceMetadataSchema,
  sleep_duration_seconds: z.number().int().nullish(),
  sleep_efficiency_percent: z.number().nullish(),
  resting_heart_rate_bpm: z.number().int().nullish(),
  avg_hrv_sdnn_ms: z.number().nullish(),
  avg_hrv_rmssd_ms: z.number().nullish(),
  avg_spo2_percent: z.number().nullish(),
  recovery_score: z.number().int().nullish(), // deprecated upstream; WHOOP only
});
export type OwRecoverySummary = z.infer<typeof owRecoverySummarySchema>;

export const owRecoverySummariesPageSchema = paginatedResponseSchema(owRecoverySummarySchema);

/** summaries.py BodySummary — GET /users/{id}/summaries/body (single object or null). */
export const owBodySummarySchema = z.object({
  source: sourceMetadataSchema,
  slow_changing: z.object({
    weight_kg: z.number().nullish(),
    height_cm: z.number().nullish(),
    body_fat_percent: z.number().nullish(),
    muscle_mass_kg: z.number().nullish(),
    bmi: z.number().nullish(),
    age: z.number().int().nullish(),
  }),
  averaged: z.object({
    period_days: z.number().int(),
    resting_heart_rate_bpm: z.number().int().nullish(),
    avg_hrv_sdnn_ms: z.number().nullish(),
    avg_hrv_rmssd_ms: z.number().nullish(),
    period_start: isoDateTime,
    period_end: isoDateTime,
  }),
  latest: z.object({
    body_temperature_celsius: z.number().nullish(),
    body_temperature_measured_at: isoDateTime.nullish(),
    skin_temperature_celsius: z.number().nullish(),
    skin_temperature_measured_at: isoDateTime.nullish(),
    blood_pressure: z
      .object({
        avg_systolic_mmhg: z.number().int().nullish(),
        avg_diastolic_mmhg: z.number().int().nullish(),
        max_systolic_mmhg: z.number().int().nullish(),
        max_diastolic_mmhg: z.number().int().nullish(),
        min_systolic_mmhg: z.number().int().nullish(),
        min_diastolic_mmhg: z.number().int().nullish(),
        reading_count: z.number().int().nullish(),
      })
      .nullish(),
    blood_pressure_measured_at: isoDateTime.nullish(),
  }),
});
export type OwBodySummary = z.infer<typeof owBodySummarySchema>;

// ---------------------------------------------------------------------------
// Health scores (routes/v1/health_scores.py + model_crud/activities/health_score.py)
// ---------------------------------------------------------------------------

/** enums/health_score_category.py HealthScoreCategory. */
export const owHealthScoreCategorySchema = z.enum([
  "sleep",
  "recovery",
  "readiness",
  "activity",
  "stress",
  "resilience",
  "body_battery",
  "strain",
]);

export const owScoreComponentSchema = z.object({
  value: z.number().nullish(),
  qualifier: z.string().nullish(),
});

export const owHealthScoreSchema = z.object({
  id: uuid,
  category: owHealthScoreCategorySchema,
  value: z.number().nullish(),
  qualifier: z.string().nullish(),
  recorded_at: isoDateTime,
  zone_offset: z.string().nullish(),
  components: z.record(z.string(), owScoreComponentSchema).nullish(),
  data_source_id: uuid.nullish(),
  provider: z.string().nullish(),
  event_record_id: uuid.nullish(),
});
export type OwHealthScore = z.infer<typeof owHealthScoreSchema>;

export const owHealthScoresPageSchema = paginatedResponseSchema(owHealthScoreSchema);

// ---------------------------------------------------------------------------
// Outgoing webhooks (routes/v1/outgoing_webhooks.py + webhooks/endpoints.py)
// ---------------------------------------------------------------------------

export const owWebhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string().nullish(),
  filter_types: z.array(z.string()).nullish(),
  user_id: uuid.nullish(),
});
export type OwWebhookEndpoint = z.infer<typeof owWebhookEndpointSchema>;

export const owWebhookEndpointListSchema = z.array(owWebhookEndpointSchema);

export const owWebhookEndpointSecretSchema = z.object({ key: z.string() });

/**
 * Group-level webhook event types (webhooks/event_types.py WebhookEventType).
 * Granular per-metric events follow `series.<series_type>.created` and are
 * matched by prefix, not enumerated here.
 */
export const OW_WEBHOOK_EVENT_TYPES = [
  "connection.created",
  "connection.revoked",
  "sync.started",
  "sync.completed",
  "sync.failed",
  "workout.created",
  "sleep.created",
  "menstrual_cycle.created",
  "heart_rate.created",
  "heart_rate_variability.created",
  "steps.created",
  "calories.created",
  "spo2.created",
  "respiratory_rate.created",
  "body_temperature.created",
  "stress.created",
  "blood_glucose.created",
  "blood_pressure.created",
  "body_composition.created",
  "fitness_metrics.created",
  "recovery_score.created",
  "activity_timeseries.created",
  "workout_metrics.created",
  "environmental.created",
] as const;
export type OwWebhookEventType = (typeof OW_WEBHOOK_EVENT_TYPES)[number];

/**
 * Webhook payload envelope. Every message OW emits is `{ type, data }`
 * (services/outgoing_webhooks/events.py `_dispatch` callers).
 */
export const owWebhookEnvelopeSchema = z.object({
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type OwWebhookEnvelope = z.infer<typeof owWebhookEnvelopeSchema>;

/** events.py on_connection_created / on_connection_revoked payloads. */
export const owWebhookConnectionDataSchema = z.object({
  user_id: uuid,
  provider: z.string(),
  connection_id: uuid,
  connected_at: isoDateTime.nullish(), // connection.created
  reason: z.string().nullish(), // connection.revoked
  revoked_at: isoDateTime.nullish(), // connection.revoked
});

/** events.py on_workout_created payload (`data`). */
export const owWebhookWorkoutDataSchema = z.object({
  id: uuid,
  user_id: uuid,
  type: z.string().nullish(),
  start_time: isoDateTime,
  end_time: isoDateTime,
  zone_offset: z.string().nullish(),
  duration_seconds: z.number().nullish(),
  source: z.object({ provider: z.string(), device: z.string().nullish() }),
  calories_kcal: z.number().nullish(),
  distance_meters: z.number().nullish(),
  avg_heart_rate_bpm: z.number().int().nullish(),
  max_heart_rate_bpm: z.number().int().nullish(),
  avg_pace_sec_per_km: z.number().nullish(),
  elevation_gain_meters: z.number().nullish(),
});

/** events.py on_sleep_created payload (`data`). */
export const owWebhookSleepDataSchema = z.object({
  id: uuid,
  user_id: uuid,
  start_time: isoDateTime,
  end_time: isoDateTime,
  zone_offset: z.string().nullish(),
  duration_seconds: z.number().nullish(),
  source: z.object({ provider: z.string(), device: z.string().nullish() }),
  efficiency_percent: z.number().nullish(),
  stages: z.record(z.string(), z.number().int().nullable()).nullish(),
  is_nap: z.boolean().nullish(),
});

/** events.py on_timeseries_batch_saved payload (group and `series.*` events). */
export const owWebhookTimeseriesDataSchema = z.object({
  user_id: uuid,
  provider: z.string(),
  series_type: z.string(),
  sample_count: z.number().int(),
  start_time: isoDateTime.nullish(),
  end_time: isoDateTime.nullish(),
  samples: z.array(z.record(z.string(), z.unknown())),
  chunk_index: z.number().int().nullish(),
  total_chunks: z.number().int().nullish(),
});

/** events.py on_sync_started / on_sync_completed / on_sync_failed payloads. */
export const owWebhookSyncDataSchema = z.object({
  user_id: uuid,
  provider: z.string(),
  source: z.string(),
  run_id: z.string(),
  status: z.string().nullish(), // sync.completed
  error: z.string().nullish(), // sync.failed
  message: z.string().nullish(),
  items_processed: z.number().int().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
