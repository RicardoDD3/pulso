/**
 * Pulso canonical schema (spec doc 02).
 *
 * Conventions:
 * - uuid PKs (gen_random_uuid) except series tables (bigint identity).
 * - Every data table has user_id NOT NULL → users.id ON DELETE CASCADE:
 *   deleting an account deletes everything, guaranteed by the DB.
 * - timestamptz for instants, date for calendar dates (user tz in profiles).
 * - Canonical units: meters, seconds, °C, kg, ml, ms.
 * - Provider-sourced rows keep their raw JSONB + provider.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  bigint,
  numeric,
  boolean,
  jsonb,
  doublePrecision,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* 1. Identity (Better Auth owns users/sessions/accounts/verifications) */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const twoFactors = pgTable("two_factors", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret"),
  backupCodes: text("backup_codes"),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  birthDate: date("birth_date"),
  sex: text("sex"),
  maxHr: integer("max_hr"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  unitSystem: text("unit_system").notNull().default("metric"),
  primaryProvider: text("primary_provider"),
  role: text("role").notNull().default("user"),
});

export const dataGrants = pgTable(
  "data_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    granteeId: uuid("grantee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("data_grants_owner_grantee_uq").on(t.ownerId, t.granteeId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid("actor_id"),
    ownerId: uuid("owner_id"),
    action: text("action").notNull(),
    resource: text("resource"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_owner_idx").on(t.ownerId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* 2. Wearables (canonical)                                            */
/* ------------------------------------------------------------------ */

export const wearableAccounts = pgTable("wearable_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  owUserId: uuid("ow_user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wearableConnections = pgTable(
  "wearable_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    detail: jsonb("detail"),
  },
  (t) => [uniqueIndex("wearable_connections_user_provider_uq").on(t.userId, t.provider)],
);

export const healthDays = pgTable(
  "health_days",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    provider: text("provider").notNull(),
    steps: integer("steps"),
    floors: integer("floors"),
    intensityMinutes: integer("intensity_minutes"),
    distanceM: integer("distance_m"),
    caloriesTotal: integer("calories_total"),
    caloriesActive: integer("calories_active"),
    restingHr: integer("resting_hr"),
    hrMin: integer("hr_min"),
    hrMax: integer("hr_max"),
    stressAvg: integer("stress_avg"),
    stressMax: integer("stress_max"),
    bodyBatteryHigh: integer("body_battery_high"),
    bodyBatteryLow: integer("body_battery_low"),
    spo2Avg: numeric("spo2_avg", { mode: "number" }),
    respirationAvg: numeric("respiration_avg", { mode: "number" }),
    hrvMs: numeric("hrv_ms", { mode: "number" }),
    hrvStatus: text("hrv_status"),
    hydrationMl: integer("hydration_ml"),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("health_days_user_date_provider_uq").on(t.userId, t.date, t.provider),
    index("health_days_user_date_idx").on(t.userId, t.date),
  ],
);

export const sleepSessions = pgTable(
  "sleep_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    totalMin: integer("total_min"),
    inBedMin: integer("in_bed_min"),
    efficiency: numeric("efficiency", { mode: "number" }),
    deepMin: integer("deep_min"),
    lightMin: integer("light_min"),
    remMin: integer("rem_min"),
    awakeMin: integer("awake_min"),
    score: integer("score"),
    isNap: boolean("is_nap").notNull().default(false),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("sleep_sessions_user_provider_ext_uq").on(t.userId, t.provider, t.externalId),
    index("sleep_sessions_user_start_idx").on(t.userId, t.startAt),
  ],
);

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    weightKg: numeric("weight_kg", { mode: "number" }),
    bmi: numeric("bmi", { mode: "number" }),
    bodyFatPct: numeric("body_fat_pct", { mode: "number" }),
    muscleMassKg: numeric("muscle_mass_kg", { mode: "number" }),
    bodyWaterPct: numeric("body_water_pct", { mode: "number" }),
    boneMassKg: numeric("bone_mass_kg", { mode: "number" }),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("body_measurements_user_provider_at_uq").on(t.userId, t.provider, t.measuredAt),
    index("body_measurements_user_at_idx").on(t.userId, t.measuredAt),
  ],
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    sport: text("sport").notNull(),
    name: text("name"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    durationS: integer("duration_s").notNull(),
    movingS: integer("moving_s"),
    distanceM: numeric("distance_m", { mode: "number" }),
    calories: integer("calories"),
    hrAvg: integer("hr_avg"),
    hrMax: integer("hr_max"),
    hrMin: integer("hr_min"),
    elevationGainM: numeric("elevation_gain_m", { mode: "number" }),
    elevationLossM: numeric("elevation_loss_m", { mode: "number" }),
    cadenceAvg: numeric("cadence_avg", { mode: "number" }),
    speedAvgMps: numeric("speed_avg_mps", { mode: "number" }),
    speedMaxMps: numeric("speed_max_mps", { mode: "number" }),
    powerAvgW: numeric("power_avg_w", { mode: "number" }),
    powerMaxW: numeric("power_max_w", { mode: "number" }),
    aerobicTe: numeric("aerobic_te", { mode: "number" }),
    anaerobicTe: numeric("anaerobic_te", { mode: "number" }),
    trainingLoad: numeric("training_load", { mode: "number" }),
    teLabel: text("te_label"),
    gapMps: numeric("gap_mps", { mode: "number" }),
    vo2max: numeric("vo2max", { mode: "number" }),
    detailSource: text("detail_source"),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("workouts_user_provider_ext_uq").on(t.userId, t.provider, t.externalId),
    index("workouts_user_start_idx").on(t.userId, t.startAt),
  ],
);

export const workoutLaps = pgTable(
  "workout_laps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'lap' | 'split'
    lapIndex: integer("lap_index").notNull(),
    intensityType: text("intensity_type"),
    startAt: timestamp("start_at", { withTimezone: true }),
    durationS: numeric("duration_s", { mode: "number" }),
    distanceM: numeric("distance_m", { mode: "number" }),
    hrAvg: integer("hr_avg"),
    hrMax: integer("hr_max"),
    speedAvgMps: numeric("speed_avg_mps", { mode: "number" }),
    cadenceAvg: numeric("cadence_avg", { mode: "number" }),
    powerAvgW: numeric("power_avg_w", { mode: "number" }),
    strideLengthCm: numeric("stride_length_cm", { mode: "number" }),
    verticalOscillationCm: numeric("vertical_oscillation_cm", { mode: "number" }),
    verticalRatio: numeric("vertical_ratio", { mode: "number" }),
    groundContactTimeMs: numeric("ground_contact_time_ms", { mode: "number" }),
    elevationGainM: numeric("elevation_gain_m", { mode: "number" }),
    elevationLossM: numeric("elevation_loss_m", { mode: "number" }),
    startLat: doublePrecision("start_lat"),
    startLng: doublePrecision("start_lng"),
    endLat: doublePrecision("end_lat"),
    endLng: doublePrecision("end_lng"),
    raw: jsonb("raw"),
  },
  (t) => [uniqueIndex("workout_laps_workout_kind_idx_uq").on(t.workoutId, t.kind, t.lapIndex)],
);

export const workoutRoutePoints = pgTable(
  "workout_route_points",
  {
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    elevationM: numeric("elevation_m", { mode: "number" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.seq] })],
);

export const workoutHrZones = pgTable(
  "workout_hr_zones",
  {
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    zone: integer("zone").notNull(),
    seconds: integer("seconds").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.zone] })],
);

export const workoutWeather = pgTable("workout_weather", {
  workoutId: uuid("workout_id")
    .primaryKey()
    .references(() => workouts.id, { onDelete: "cascade" }),
  tempC: numeric("temp_c", { mode: "number" }),
  apparentTempC: numeric("apparent_temp_c", { mode: "number" }),
  dewPointC: numeric("dew_point_c", { mode: "number" }),
  relativeHumidity: numeric("relative_humidity", { mode: "number" }),
  windSpeedMs: numeric("wind_speed_ms", { mode: "number" }),
  windDirectionDeg: numeric("wind_direction_deg", { mode: "number" }),
  weatherCode: integer("weather_code"),
  source: text("source").notNull().default("open-meteo"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metricSamples = pgTable(
  "metric_samples",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(), // 'hr'|'stress'|'body_battery'|'spo2'|'respiration'
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    value: numeric("value", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
  },
  (t) => [
    uniqueIndex("metric_samples_uq").on(t.userId, t.metric, t.provider, t.recordedAt),
    index("metric_samples_user_metric_at_idx").on(t.userId, t.metric, t.recordedAt),
  ],
);

export const providerScores = pgTable(
  "provider_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    provider: text("provider").notNull(),
    scores: jsonb("scores").notNull(),
  },
  (t) => [uniqueIndex("provider_scores_user_date_provider_uq").on(t.userId, t.date, t.provider)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider"),
    kind: text("kind").notNull(), // 'webhook'|'reconcile'|'manual'|'backfill'
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_user_started_idx").on(t.userId, t.startedAt)],
);

/* ------------------------------------------------------------------ */
/* 3. Labs                                                             */
/* ------------------------------------------------------------------ */

export const labSessions = pgTable(
  "lab_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sampleDate: date("sample_date"),
    labName: text("lab_name"),
    labLocation: text("lab_location"),
    patientName: text("patient_name"),
    patientDob: text("patient_dob"),
    patientSex: text("patient_sex"),
    patientAge: text("patient_age"),
    doctorName: text("doctor_name"),
    notes: text("notes"),
    status: text("status").notNull().default("completed"), // 'processing'|'completed'|'failed'
    error: text("error"),
    sourceFilePath: text("source_file_path"),
    extractionModel: text("extraction_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lab_sessions_user_date_idx").on(t.userId, t.sampleDate)],
);

export const labResults = pgTable(
  "lab_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => labSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    testName: text("test_name").notNull(),
    testNameNormalized: text("test_name_normalized"),
    valueNum: numeric("value_num", { mode: "number" }),
    valueText: text("value_text"),
    unit: text("unit"),
    refLow: numeric("ref_low", { mode: "number" }),
    refHigh: numeric("ref_high", { mode: "number" }),
    refText: text("ref_text"),
    isFlagged: boolean("is_flagged").notNull().default(false),
  },
  (t) => [index("lab_results_user_test_idx").on(t.userId, t.testNameNormalized)],
);

/* ------------------------------------------------------------------ */
/* 4. Coach (unified chats)                                            */
/* ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'coach'|'tracking'|'planner'
    title: text("title"),
    // NULL = "follow the instance default" — only an explicit user choice persists
    // a model (kills the frozen-default bug of the original by design).
    model: text("model"),
    planId: uuid("plan_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_kind_idx").on(t.userId, t.kind, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user'|'assistant'|'system'
    content: text("content").notNull(),
    action: text("action"), // planner only
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* 5. Training                                                         */
/* ------------------------------------------------------------------ */

export const trainingPlans = pgTable(
  "training_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goalType: text("goal_type"),
    goalDate: date("goal_date"),
    goalTime: text("goal_time"),
    goalDistanceKm: numeric("goal_distance_km", { mode: "number" }),
    availableDays: jsonb("available_days"),
    terrain: text("terrain"),
    planJson: jsonb("plan_json").notNull(),
    llmUsed: text("llm_used"),
    status: text("status").notNull().default("active"), // 'active'|'completed'|'abandoned'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("training_plans_user_idx").on(t.userId, t.status)],
);

export const trainingPlanWorkouts = pgTable(
  "training_plan_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    date: date("date"),
    workoutType: text("workout_type").notNull(),
    title: text("title"),
    targetDistanceKm: numeric("target_distance_km", { mode: "number" }),
    targetPaceRange: text("target_pace_range"),
    targetHrZone: text("target_hr_zone"),
    matchedWorkoutId: uuid("matched_workout_id").references(() => workouts.id, {
      onDelete: "set null",
    }),
    matchedManualId: uuid("matched_manual_id"),
    status: text("status").notNull().default("pending"),
    actualDistanceKm: numeric("actual_distance_km", { mode: "number" }),
    actualPace: text("actual_pace"),
  },
  (t) => [index("training_plan_workouts_plan_idx").on(t.planId, t.weekNumber)],
);

export const trainingPlanVersions = pgTable(
  "training_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => trainingPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planJson: jsonb("plan_json").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("training_plan_versions_plan_idx").on(t.planId, t.createdAt)],
);

export const trainingSettings = pgTable("training_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stepsGoalMin: integer("steps_goal_min").notNull().default(150000),
  stepsGoalMax: integer("steps_goal_max").notNull().default(200000),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const manualWorkouts = pgTable(
  "manual_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => trainingPlans.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    workoutType: text("workout_type").notNull(), // 'strength'|'mobility'|'cross_training'
    title: text("title"),
    exercises: jsonb("exercises"),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
  },
  (t) => [index("manual_workouts_user_date_idx").on(t.userId, t.date)],
);

/* ------------------------------------------------------------------ */
/* 6. Exercises                                                        */
/* ------------------------------------------------------------------ */

export const exerciseDefinitions = pgTable(
  "exercise_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseKey: text("exercise_key").notNull(),
    label: text("label").notNull(),
    emoji: text("emoji"),
    color: text("color"),
    type: text("type").notNull(), // 'bodyweight'|'weighted'
    increment: integer("increment"),
    weeklyGoal: integer("weekly_goal"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exercise_definitions_user_key_uq").on(t.userId, t.exerciseKey)],
);

export const exerciseLogs = pgTable(
  "exercise_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    exerciseKey: text("exercise_key").notNull(),
    reps: integer("reps").notNull(),
  },
  (t) => [uniqueIndex("exercise_logs_user_date_key_uq").on(t.userId, t.date, t.exerciseKey)],
);

export const exerciseSets = pgTable(
  "exercise_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    exerciseKey: text("exercise_key").notNull(),
    setNumber: integer("set_number").notNull(),
    weightKg: numeric("weight_kg", { mode: "number" }),
    reps: integer("reps").notNull(),
  },
  (t) => [
    uniqueIndex("exercise_sets_user_date_key_set_uq").on(t.userId, t.date, t.exerciseKey, t.setNumber),
  ],
);

/* ------------------------------------------------------------------ */
/* 7. Platform                                                         */
/* ------------------------------------------------------------------ */

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    costUsdEstimate: numeric("cost_usd_estimate", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_usage_user_created_idx").on(t.userId, t.createdAt)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* Row types */
export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type DataGrantRow = typeof dataGrants.$inferSelect;
export type HealthDayRow = typeof healthDays.$inferSelect;
export type SleepSessionRow = typeof sleepSessions.$inferSelect;
export type BodyMeasurementRow = typeof bodyMeasurements.$inferSelect;
export type WorkoutRow = typeof workouts.$inferSelect;
export type WorkoutLapRow = typeof workoutLaps.$inferSelect;
export type MetricSampleRow = typeof metricSamples.$inferSelect;
export type LabSessionRow = typeof labSessions.$inferSelect;
export type LabResultRow = typeof labResults.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TrainingPlanRow = typeof trainingPlans.$inferSelect;
export type ExerciseDefinitionRow = typeof exerciseDefinitions.$inferSelect;
export type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
export type ExerciseSetRow = typeof exerciseSets.$inferSelect;
