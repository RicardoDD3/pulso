CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"owner_id" uuid,
	"action" text NOT NULL,
	"resource" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight_kg" numeric,
	"bmi" numeric,
	"body_fat_pct" numeric,
	"muscle_mass_kg" numeric,
	"body_water_pct" numeric,
	"bone_mass_kg" numeric,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"model" text,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "exercise_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_key" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text,
	"color" text,
	"type" text NOT NULL,
	"increment" integer,
	"weekly_goal" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"exercise_key" text NOT NULL,
	"reps" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"exercise_key" text NOT NULL,
	"set_number" integer NOT NULL,
	"weight_kg" numeric,
	"reps" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_days" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "health_days_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"provider" text NOT NULL,
	"steps" integer,
	"floors" integer,
	"intensity_minutes" integer,
	"distance_m" integer,
	"calories_total" integer,
	"calories_active" integer,
	"resting_hr" integer,
	"hr_min" integer,
	"hr_max" integer,
	"stress_avg" integer,
	"stress_max" integer,
	"body_battery_high" integer,
	"body_battery_low" integer,
	"spo2_avg" numeric,
	"respiration_avg" numeric,
	"hrv_ms" numeric,
	"hrv_status" text,
	"hydration_ml" integer,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"test_name" text NOT NULL,
	"test_name_normalized" text,
	"value_num" numeric,
	"value_text" text,
	"unit" text,
	"ref_low" numeric,
	"ref_high" numeric,
	"ref_text" text,
	"is_flagged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sample_date" date,
	"lab_name" text,
	"lab_location" text,
	"patient_name" text,
	"patient_dob" text,
	"patient_sex" text,
	"patient_age" text,
	"doctor_name" text,
	"notes" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"source_file_path" text,
	"extraction_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"tokens_cached" integer DEFAULT 0 NOT NULL,
	"cost_usd_estimate" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"date" date NOT NULL,
	"workout_type" text NOT NULL,
	"title" text,
	"exercises" jsonb,
	"duration_minutes" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"action" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metric_samples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"value" numeric NOT NULL,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"birth_date" date,
	"sex" text,
	"max_hr" integer,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"unit_system" text DEFAULT 'metric' NOT NULL,
	"primary_provider" text,
	"role" text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"provider" text NOT NULL,
	"scores" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sleep_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"total_min" integer,
	"in_bed_min" integer,
	"efficiency" numeric,
	"deep_min" integer,
	"light_min" integer,
	"rem_min" integer,
	"awake_min" integer,
	"score" integer,
	"is_nap" boolean DEFAULT false NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_json" jsonb NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plan_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"date" date,
	"workout_type" text NOT NULL,
	"title" text,
	"target_distance_km" numeric,
	"target_pace_range" text,
	"target_hr_zone" text,
	"matched_workout_id" uuid,
	"matched_manual_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"actual_distance_km" numeric,
	"actual_pace" text
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal_type" text,
	"goal_date" date,
	"goal_time" text,
	"goal_distance_km" numeric,
	"available_days" jsonb,
	"terrain" text,
	"plan_json" jsonb NOT NULL,
	"llm_used" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"steps_goal_min" integer DEFAULT 150000 NOT NULL,
	"steps_goal_max" integer DEFAULT 200000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text,
	"backup_codes" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wearable_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ow_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wearable_accounts_ow_user_id_unique" UNIQUE("ow_user_id")
);
--> statement-breakpoint
CREATE TABLE "wearable_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"connected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "workout_hr_zones" (
	"workout_id" uuid NOT NULL,
	"zone" integer NOT NULL,
	"seconds" integer NOT NULL,
	CONSTRAINT "workout_hr_zones_workout_id_zone_pk" PRIMARY KEY("workout_id","zone")
);
--> statement-breakpoint
CREATE TABLE "workout_laps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lap_index" integer NOT NULL,
	"intensity_type" text,
	"start_at" timestamp with time zone,
	"duration_s" numeric,
	"distance_m" numeric,
	"hr_avg" integer,
	"hr_max" integer,
	"speed_avg_mps" numeric,
	"cadence_avg" numeric,
	"power_avg_w" numeric,
	"stride_length_cm" numeric,
	"vertical_oscillation_cm" numeric,
	"vertical_ratio" numeric,
	"ground_contact_time_ms" numeric,
	"elevation_gain_m" numeric,
	"elevation_loss_m" numeric,
	"start_lat" double precision,
	"start_lng" double precision,
	"end_lat" double precision,
	"end_lng" double precision,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "workout_route_points" (
	"workout_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"elevation_m" numeric,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "workout_route_points_workout_id_seq_pk" PRIMARY KEY("workout_id","seq")
);
--> statement-breakpoint
CREATE TABLE "workout_weather" (
	"workout_id" uuid PRIMARY KEY NOT NULL,
	"temp_c" numeric,
	"apparent_temp_c" numeric,
	"dew_point_c" numeric,
	"relative_humidity" numeric,
	"wind_speed_ms" numeric,
	"wind_direction_deg" numeric,
	"weather_code" integer,
	"source" text DEFAULT 'open-meteo' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"sport" text NOT NULL,
	"name" text,
	"start_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"moving_s" integer,
	"distance_m" numeric,
	"calories" integer,
	"hr_avg" integer,
	"hr_max" integer,
	"hr_min" integer,
	"elevation_gain_m" numeric,
	"elevation_loss_m" numeric,
	"cadence_avg" numeric,
	"speed_avg_mps" numeric,
	"speed_max_mps" numeric,
	"power_avg_w" numeric,
	"power_max_w" numeric,
	"aerobic_te" numeric,
	"anaerobic_te" numeric,
	"training_load" numeric,
	"te_label" text,
	"gap_mps" numeric,
	"vo2max" numeric,
	"detail_source" text,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_grants" ADD CONSTRAINT "data_grants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_grants" ADD CONSTRAINT "data_grants_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_definitions" ADD CONSTRAINT "exercise_definitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_days" ADD CONSTRAINT "health_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_session_id_lab_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lab_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_sessions" ADD CONSTRAINT "lab_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_workouts" ADD CONSTRAINT "manual_workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_workouts" ADD CONSTRAINT "manual_workouts_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_scores" ADD CONSTRAINT "provider_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_sessions" ADD CONSTRAINT "sleep_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_workouts" ADD CONSTRAINT "training_plan_workouts_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_workouts" ADD CONSTRAINT "training_plan_workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plan_workouts" ADD CONSTRAINT "training_plan_workouts_matched_workout_id_workouts_id_fk" FOREIGN KEY ("matched_workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_settings" ADD CONSTRAINT "training_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wearable_accounts" ADD CONSTRAINT "wearable_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wearable_connections" ADD CONSTRAINT "wearable_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_hr_zones" ADD CONSTRAINT "workout_hr_zones_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_laps" ADD CONSTRAINT "workout_laps_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_route_points" ADD CONSTRAINT "workout_route_points_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_weather" ADD CONSTRAINT "workout_weather_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_owner_idx" ON "audit_log" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_user_provider_at_uq" ON "body_measurements" USING btree ("user_id","provider","measured_at");--> statement-breakpoint
CREATE INDEX "body_measurements_user_at_idx" ON "body_measurements" USING btree ("user_id","measured_at");--> statement-breakpoint
CREATE INDEX "conversations_user_kind_idx" ON "conversations" USING btree ("user_id","kind","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_grants_owner_grantee_uq" ON "data_grants" USING btree ("owner_id","grantee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_definitions_user_key_uq" ON "exercise_definitions" USING btree ("user_id","exercise_key");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_logs_user_date_key_uq" ON "exercise_logs" USING btree ("user_id","date","exercise_key");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_sets_user_date_key_set_uq" ON "exercise_sets" USING btree ("user_id","date","exercise_key","set_number");--> statement-breakpoint
CREATE UNIQUE INDEX "health_days_user_date_provider_uq" ON "health_days" USING btree ("user_id","date","provider");--> statement-breakpoint
CREATE INDEX "health_days_user_date_idx" ON "health_days" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "lab_results_user_test_idx" ON "lab_results" USING btree ("user_id","test_name_normalized");--> statement-breakpoint
CREATE INDEX "lab_sessions_user_date_idx" ON "lab_sessions" USING btree ("user_id","sample_date");--> statement-breakpoint
CREATE INDEX "llm_usage_user_created_idx" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "manual_workouts_user_date_idx" ON "manual_workouts" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_samples_uq" ON "metric_samples" USING btree ("user_id","metric","provider","recorded_at");--> statement-breakpoint
CREATE INDEX "metric_samples_user_metric_at_idx" ON "metric_samples" USING btree ("user_id","metric","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_scores_user_date_provider_uq" ON "provider_scores" USING btree ("user_id","date","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_sessions_user_provider_ext_uq" ON "sleep_sessions" USING btree ("user_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "sleep_sessions_user_start_idx" ON "sleep_sessions" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_idx" ON "sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "training_plan_versions_plan_idx" ON "training_plan_versions" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "training_plan_workouts_plan_idx" ON "training_plan_workouts" USING btree ("plan_id","week_number");--> statement-breakpoint
CREATE INDEX "training_plans_user_idx" ON "training_plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wearable_connections_user_provider_uq" ON "wearable_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_laps_workout_kind_idx_uq" ON "workout_laps" USING btree ("workout_id","kind","lap_index");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_user_provider_ext_uq" ON "workouts" USING btree ("user_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "workouts_user_start_idx" ON "workouts" USING btree ("user_id","start_at");