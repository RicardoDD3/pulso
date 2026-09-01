/**
 * One-shot data migration from el-consejo's Garmin Supabase DB into Pulso
 * (spec doc 13). Reads the origin with the `postgres` driver, maps rows with
 * the pure mappers in lib/migration/mappers.ts and upserts into the Pulso DB
 * (DATABASE_URL). Dry-run by default: without --yes it only counts and prints
 * the per-table plan.
 *
 *   npx tsx scripts/migrate-from-el-consejo.ts \
 *     --source-url postgres://...   # el-consejo Garmin Supabase (direct/session string, not the transaction pooler)
 *     [--main-url postgres://...]   # accepted for parity; no migrated table lives there
 *     --user <clerkId>=<pulsoUserId>   # repeatable, one per migrated account
 *     [--samples-days N]            # plan B (doc 13): only last N days of intraday samples
 *     [--yes]                       # actually write
 *
 * Idempotent: every insert is ON CONFLICT DO NOTHING on a natural key or on a
 * deterministic uuid derived from the origin PK, so re-running never
 * duplicates and never overwrites rows another writer (e.g. the OW backfill)
 * already owns. Ends with per-table migrated/skipped counts and a
 * verification block (steps of the last full month, workout count, lab_results
 * count per user) to compare against the origin.
 */
// Load .env when run outside Next (tsx CLI); no-op if the file is absent.
try {
  process.loadEnvFile(".env");
} catch {
  /* env comes from the environment */
}

import postgres from "postgres";
import { and, eq, gte, lte, sql as dsql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  mapDailySummary,
  mapSleep,
  mapBodyComposition,
  mapActivity,
  mapActivityLap,
  mapActivitySplit,
  mapActivityWeather,
  mapMetricSample,
  mapLabSession,
  mapLabResult,
  mapConversation,
  mapChatMessage,
  mapTrainingPlan,
  mapPlanWorkout,
  mapPlanVersion,
  mapTrainingSettings,
  mapExerciseDefinition,
  mapExerciseLog,
  mapExerciseSet,
  extractHrZones,
  MIGRATION_PROVIDER,
  type SampleMetric,
  type SrcActivity,
  type SrcActivityLap,
  type SrcActivitySplit,
  type SrcActivityWeather,
  type SrcBodyComposition,
  type SrcChatMessage,
  type SrcConversation,
  type SrcDailySummary,
  type SrcExerciseDefinition,
  type SrcExerciseLog,
  type SrcExerciseSet,
  type SrcLabResult,
  type SrcLabSession,
  type SrcPlanVersion,
  type SrcPlanWorkout,
  type SrcSample,
  type SrcSleep,
  type SrcTrainingPlan,
  type SrcTrainingSettings,
} from "@/lib/migration/mappers";

type Sql = ReturnType<typeof postgres>;
type Db = ReturnType<typeof getDb>;

interface CliArgs {
  sourceUrl: string;
  mainUrl?: string;
  users: Map<string, string>; // clerkId → pulso user uuid
  yes: boolean;
  samplesDays?: number;
}

interface TableStat {
  table: string;
  source: number;
  migrated: number;
  skipped: number;
}

const SAMPLE_SOURCES: { metric: SampleMetric; table: string; valueCol: string }[] = [
  { metric: "hr", table: "heart_rate_samples", valueCol: "heart_rate" },
  { metric: "body_battery", table: "body_battery_samples", valueCol: "level" },
  { metric: "stress", table: "stress_samples", valueCol: "stress_level" },
];

const SAMPLE_BATCH = 10_000;
const INSERT_CHUNK = 1_000;

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/migrate-from-el-consejo.ts --source-url <url> " +
      "[--main-url <url>] --user <clerkId>=<pulsoUserId> [--user ...] " +
      "[--samples-days N] [--yes]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const users = new Map<string, string>();
  let sourceUrl: string | undefined;
  let mainUrl: string | undefined;
  let yes = false;
  let samplesDays: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage();
      return v;
    };
    if (arg === "--source-url") sourceUrl = next();
    else if (arg === "--main-url") mainUrl = next();
    else if (arg === "--user") {
      const pair = next();
      const idx = pair.indexOf("=");
      if (idx <= 0 || idx === pair.length - 1) usage();
      users.set(pair.slice(0, idx), pair.slice(idx + 1));
    } else if (arg === "--samples-days") {
      samplesDays = Number(next());
      if (!Number.isInteger(samplesDays) || samplesDays <= 0) usage();
    } else if (arg === "--yes") yes = true;
    else usage();
  }
  if (!sourceUrl || users.size === 0) usage();
  return { sourceUrl, mainUrl, users, yes, samplesDays };
}

function log(line: string): void {
  console.log(line);
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Rows actually written by an insert (postgres-js reports affected count). */
async function insertCount(q: PromiseLike<unknown>): Promise<number> {
  const res = (await q) as { count?: number };
  return typeof res.count === "number" ? res.count : 0;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function samplesCutoff(samplesDays: number | undefined): string | null {
  if (!samplesDays) return null;
  return isoDay(new Date(Date.now() - samplesDays * 86_400_000));
}

async function countRows(source: Sql, query: PromiseLike<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Dry-run: count what WOULD be migrated                               */
/* ------------------------------------------------------------------ */

async function planUser(source: Sql, clerkId: string, cutoff: string | null): Promise<TableStat[]> {
  const simple = async (table: string) =>
    countRows(
      source,
      source`select count(*)::int as n from ${source(table)} where clerk_id = ${clerkId}`,
    );
  const stats: TableStat[] = [];
  const add = (table: string, n: number) => stats.push({ table, source: n, migrated: 0, skipped: 0 });

  add("daily_summary → health_days", await simple("daily_summary"));
  add("sleep → sleep_sessions", await simple("sleep"));
  add("body_composition → body_measurements", await simple("body_composition"));
  add("activities → workouts", await simple("activities"));
  add("activity_laps → workout_laps", await simple("activity_laps"));
  add("activity_typed_splits → workout_laps", await simple("activity_typed_splits"));
  add("activity_weather → workout_weather", await simple("activity_weather"));
  for (const s of SAMPLE_SOURCES) {
    const n = await countRows(
      source,
      cutoff
        ? source`select count(*)::int as n from ${source(s.table)} where clerk_id = ${clerkId} and date >= ${cutoff}`
        : source`select count(*)::int as n from ${source(s.table)} where clerk_id = ${clerkId}`,
    );
    add(`${s.table} → metric_samples(${s.metric})`, n);
  }
  add("lab_sessions → lab_sessions", await simple("lab_sessions"));
  add(
    "lab_results → lab_results",
    await countRows(
      source,
      source`select count(*)::int as n from lab_results r
             join lab_sessions s on s.id = r.session_id where s.clerk_id = ${clerkId}`,
    ),
  );
  add("coach_conversations → conversations(coach)", await simple("coach_conversations"));
  add(
    "coach_messages → messages",
    await countRows(
      source,
      source`select count(*)::int as n from coach_messages m
             join coach_conversations c on c.id = m.conversation_id where c.clerk_id = ${clerkId}`,
    ),
  );
  add(
    "training_planner_conversations → conversations(planner)",
    await simple("training_planner_conversations"),
  );
  add(
    "training_planner_messages → messages",
    await countRows(
      source,
      source`select count(*)::int as n from training_planner_messages m
             join training_planner_conversations c on c.id = m.conversation_id
             where c.clerk_id = ${clerkId}`,
    ),
  );
  add("training_plans → training_plans", await simple("training_plans"));
  add(
    "training_plan_workouts → training_plan_workouts",
    await countRows(
      source,
      source`select count(*)::int as n from training_plan_workouts w
             join training_plans p on p.id = w.plan_id where p.clerk_id = ${clerkId}`,
    ),
  );
  add("training_plan_versions → training_plan_versions", await simple("training_plan_versions"));
  add("training_settings → training_settings", await simple("training_settings"));
  add("exercise_definitions → exercise_definitions", await simple("exercise_definitions"));
  add("exercise_logs → exercise_logs", await simple("exercise_logs"));
  add("exercise_sets → exercise_sets", await simple("exercise_sets"));
  return stats;
}

/* ------------------------------------------------------------------ */
/* Real migration                                                      */
/* ------------------------------------------------------------------ */

async function migrateUser(
  source: Sql,
  db: Db,
  clerkId: string,
  userId: string,
  cutoff: string | null,
): Promise<TableStat[]> {
  const stats: TableStat[] = [];
  const add = (table: string, sourceN: number, migrated: number) =>
    stats.push({ table, source: sourceN, migrated, skipped: sourceN - migrated });

  // --- health days ---
  {
    const rows = await source<SrcDailySummary[]>`
      select * from daily_summary where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const batch of chunk(rows.map((r) => mapDailySummary(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(db.insert(schema.healthDays).values(batch).onConflictDoNothing());
    }
    add("daily_summary → health_days", rows.length, migrated);
  }

  // --- sleep ---
  {
    const rows = await source<SrcSleep[]>`select * from sleep where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const batch of chunk(rows.map((r) => mapSleep(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(
        db.insert(schema.sleepSessions).values(batch).onConflictDoNothing(),
      );
    }
    add("sleep → sleep_sessions", rows.length, migrated);
  }

  // --- body composition ---
  {
    const rows = await source<SrcBodyComposition[]>`
      select * from body_composition where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const batch of chunk(rows.map((r) => mapBodyComposition(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(
        db.insert(schema.bodyMeasurements).values(batch).onConflictDoNothing(),
      );
    }
    add("body_composition → body_measurements", rows.length, migrated);
  }

  // --- activities → workouts (+ hr zones from raw_summary) ---
  const activities = await source<SrcActivity[]>`
    select * from activities where clerk_id = ${clerkId} order by activity_id`;
  {
    let migrated = 0;
    for (const batch of chunk(activities.map((r) => mapActivity(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(db.insert(schema.workouts).values(batch).onConflictDoNothing());
    }
    add("activities → workouts", activities.length, migrated);
  }

  // Resolve the REAL workout uuid per activity_id: if a workout already existed
  // (e.g. OW backfill got there first with a random uuid) children must attach
  // to that row, not to our deterministic id.
  const workoutIdByExt = new Map<string, string>();
  {
    const existing = await db
      .select({ id: schema.workouts.id, externalId: schema.workouts.externalId })
      .from(schema.workouts)
      .where(
        and(eq(schema.workouts.userId, userId), eq(schema.workouts.provider, MIGRATION_PROVIDER)),
      );
    for (const w of existing) workoutIdByExt.set(w.externalId, w.id);
  }

  {
    const zoneRows: (typeof schema.workoutHrZones.$inferInsert)[] = [];
    for (const a of activities) {
      const workoutId = workoutIdByExt.get(String(a.activity_id));
      if (!workoutId) continue;
      for (const z of extractHrZones(a.raw_summary)) zoneRows.push({ workoutId, ...z });
    }
    let migrated = 0;
    for (const batch of chunk(zoneRows, INSERT_CHUNK)) {
      migrated += await insertCount(
        db.insert(schema.workoutHrZones).values(batch).onConflictDoNothing(),
      );
    }
    add("raw_summary zones → workout_hr_zones", zoneRows.length, migrated);
  }

  // --- laps + splits ---
  {
    const laps = await source<SrcActivityLap[]>`
      select * from activity_laps where clerk_id = ${clerkId}`;
    const splits = await source<SrcActivitySplit[]>`
      select * from activity_typed_splits where clerk_id = ${clerkId}`;
    const lapRows: (typeof schema.workoutLaps.$inferInsert)[] = [];
    let orphans = 0;
    for (const lap of laps) {
      const workoutId = workoutIdByExt.get(String(lap.activity_id));
      if (!workoutId) {
        orphans++;
        continue;
      }
      lapRows.push({ workoutId, ...mapActivityLap(lap) });
    }
    for (const split of splits) {
      const workoutId = workoutIdByExt.get(String(split.activity_id));
      if (!workoutId) {
        orphans++;
        continue;
      }
      lapRows.push({ workoutId, ...mapActivitySplit(split) });
    }
    if (orphans > 0) log(`  ! ${orphans} laps/splits reference activities not in workouts — skipped`);
    let migrated = 0;
    for (const batch of chunk(lapRows, INSERT_CHUNK)) {
      migrated += await insertCount(db.insert(schema.workoutLaps).values(batch).onConflictDoNothing());
    }
    add("activity_laps+typed_splits → workout_laps", laps.length + splits.length, migrated);
  }

  // --- weather ---
  {
    const rows = await source<SrcActivityWeather[]>`
      select * from activity_weather where clerk_id = ${clerkId}`;
    const weatherRows: (typeof schema.workoutWeather.$inferInsert)[] = [];
    for (const r of rows) {
      const workoutId = workoutIdByExt.get(String(r.activity_id));
      if (!workoutId) continue;
      weatherRows.push({ workoutId, ...mapActivityWeather(r) });
    }
    let migrated = 0;
    for (const batch of chunk(weatherRows, INSERT_CHUNK)) {
      migrated += await insertCount(
        db.insert(schema.workoutWeather).values(batch).onConflictDoNothing(),
      );
    }
    add("activity_weather → workout_weather", rows.length, migrated);
  }

  // --- intraday samples (keyset pagination — works through any pooler) ---
  for (const s of SAMPLE_SOURCES) {
    let lastTs = -1;
    let fetched = 0;
    let migrated = 0;
    for (;;) {
      const rows = await source<SrcSample[]>`
        select timestamp_ms, ${source(s.valueCol)} as value
        from ${source(s.table)}
        where clerk_id = ${clerkId} and timestamp_ms > ${lastTs}
          ${cutoff ? source`and date >= ${cutoff}` : source``}
        order by timestamp_ms limit ${SAMPLE_BATCH}`;
      if (rows.length === 0) break;
      fetched += rows.length;
      lastTs = Number(rows[rows.length - 1].timestamp_ms);
      const mapped = rows
        .map((r) => mapMetricSample(s.metric, r, userId))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      for (const batch of chunk(mapped, INSERT_CHUNK)) {
        migrated += await insertCount(
          db.insert(schema.metricSamples).values(batch).onConflictDoNothing(),
        );
      }
      if (rows.length < SAMPLE_BATCH) break;
    }
    add(`${s.table} → metric_samples(${s.metric})`, fetched, migrated);
  }

  // --- labs ---
  {
    const sessions = await source<SrcLabSession[]>`
      select * from lab_sessions where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const batch of chunk(sessions.map((r) => mapLabSession(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(db.insert(schema.labSessions).values(batch).onConflictDoNothing());
    }
    add("lab_sessions → lab_sessions", sessions.length, migrated);

    const results = await source<SrcLabResult[]>`
      select r.* from lab_results r
      join lab_sessions s on s.id = r.session_id where s.clerk_id = ${clerkId}`;
    let migratedResults = 0;
    for (const batch of chunk(results.map((r) => mapLabResult(r, userId)), INSERT_CHUNK)) {
      migratedResults += await insertCount(
        db.insert(schema.labResults).values(batch).onConflictDoNothing(),
      );
    }
    add("lab_results → lab_results", results.length, migratedResults);
  }

  // --- chats (coach + planner) ---
  await migrateChat(source, db, clerkId, userId, stats, {
    kind: "coach",
    convTable: "coach_conversations",
    msgTable: "coach_messages",
  });
  await migrateChat(source, db, clerkId, userId, stats, {
    kind: "planner",
    convTable: "training_planner_conversations",
    msgTable: "training_planner_messages",
  });

  // --- training plans + children ---
  {
    const plans = await source<SrcTrainingPlan[]>`
      select * from training_plans where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const plan of plans) {
      migrated += await insertCount(
        db.insert(schema.trainingPlans).values(mapTrainingPlan(plan, userId)).onConflictDoNothing(),
      );
    }
    add("training_plans → training_plans", plans.length, migrated);

    const planWorkouts = await source<SrcPlanWorkout[]>`
      select w.* from training_plan_workouts w
      join training_plans p on p.id = w.plan_id where p.clerk_id = ${clerkId}`;
    let migratedWorkouts = 0;
    for (const batch of chunk(
      planWorkouts.map((r) => mapPlanWorkout(r, userId, workoutIdByExt)),
      INSERT_CHUNK,
    )) {
      migratedWorkouts += await insertCount(
        db.insert(schema.trainingPlanWorkouts).values(batch).onConflictDoNothing(),
      );
    }
    add("training_plan_workouts → training_plan_workouts", planWorkouts.length, migratedWorkouts);

    const versions = await source<SrcPlanVersion[]>`
      select * from training_plan_versions where clerk_id = ${clerkId}`;
    let migratedVersions = 0;
    for (const batch of chunk(versions.map((r) => mapPlanVersion(r, userId)), INSERT_CHUNK)) {
      migratedVersions += await insertCount(
        db.insert(schema.trainingPlanVersions).values(batch).onConflictDoNothing(),
      );
    }
    add("training_plan_versions → training_plan_versions", versions.length, migratedVersions);

    const settings = await source<SrcTrainingSettings[]>`
      select * from training_settings where clerk_id = ${clerkId}`;
    let migratedSettings = 0;
    if (settings.length > 0) {
      migratedSettings = await insertCount(
        db
          .insert(schema.trainingSettings)
          .values(mapTrainingSettings(settings[0], userId))
          .onConflictDoNothing(),
      );
    }
    add("training_settings → training_settings", settings.length, migratedSettings);
  }

  // --- exercises ---
  {
    const defs = await source<SrcExerciseDefinition[]>`
      select * from exercise_definitions where clerk_id = ${clerkId}`;
    let migrated = 0;
    for (const batch of chunk(defs.map((r) => mapExerciseDefinition(r, userId)), INSERT_CHUNK)) {
      migrated += await insertCount(
        db.insert(schema.exerciseDefinitions).values(batch).onConflictDoNothing(),
      );
    }
    add("exercise_definitions → exercise_definitions", defs.length, migrated);

    const logs = await source<SrcExerciseLog[]>`
      select * from exercise_logs where clerk_id = ${clerkId}`;
    let migratedLogs = 0;
    for (const batch of chunk(logs.map((r) => mapExerciseLog(r, userId)), INSERT_CHUNK)) {
      migratedLogs += await insertCount(
        db.insert(schema.exerciseLogs).values(batch).onConflictDoNothing(),
      );
    }
    add("exercise_logs → exercise_logs", logs.length, migratedLogs);

    const sets = await source<SrcExerciseSet[]>`
      select * from exercise_sets where clerk_id = ${clerkId}`;
    let migratedSets = 0;
    for (const batch of chunk(sets.map((r) => mapExerciseSet(r, userId)), INSERT_CHUNK)) {
      migratedSets += await insertCount(
        db.insert(schema.exerciseSets).values(batch).onConflictDoNothing(),
      );
    }
    add("exercise_sets → exercise_sets", sets.length, migratedSets);
  }

  return stats;
}

/**
 * Conversations upsert on their deterministic uuid; messages have no natural
 * key (identity PK), so they are inserted only when their conversation was
 * newly created — an already-migrated conversation keeps its messages intact.
 */
async function migrateChat(
  source: Sql,
  db: Db,
  clerkId: string,
  userId: string,
  stats: TableStat[],
  cfg: { kind: "coach" | "planner"; convTable: string; msgTable: string },
): Promise<void> {
  const conversations = await source<SrcConversation[]>`
    select * from ${source(cfg.convTable)} where clerk_id = ${clerkId} order by id`;
  let migratedConvs = 0;
  let sourceMsgs = 0;
  let migratedMsgs = 0;
  for (const conv of conversations) {
    const inserted = await db
      .insert(schema.conversations)
      .values(mapConversation(cfg.kind, conv, userId))
      .onConflictDoNothing()
      .returning({ id: schema.conversations.id });
    const messages = await source<SrcChatMessage[]>`
      select * from ${source(cfg.msgTable)} where conversation_id = ${conv.id} order by id`;
    sourceMsgs += messages.length;
    if (inserted.length === 0) continue; // conversation (and its messages) already migrated
    migratedConvs++;
    for (const batch of chunk(messages.map((m) => mapChatMessage(cfg.kind, m)), INSERT_CHUNK)) {
      migratedMsgs += await insertCount(db.insert(schema.messages).values(batch));
    }
  }
  stats.push({
    table: `${cfg.convTable} → conversations(${cfg.kind})`,
    source: conversations.length,
    migrated: migratedConvs,
    skipped: conversations.length - migratedConvs,
  });
  stats.push({
    table: `${cfg.msgTable} → messages`,
    source: sourceMsgs,
    migrated: migratedMsgs,
    skipped: sourceMsgs - migratedMsgs,
  });
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

function lastFullMonthRange(now = new Date()): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: isoDay(new Date(Date.UTC(y, m - 1, 1))),
    end: isoDay(new Date(Date.UTC(y, m, 0))),
  };
}

async function verifyUser(source: Sql, db: Db, clerkId: string, userId: string): Promise<void> {
  const { start, end } = lastFullMonthRange();

  const [srcSteps] = await source<{ total: string }[]>`
    select coalesce(sum(steps), 0)::bigint as total from daily_summary
    where clerk_id = ${clerkId} and date between ${start} and ${end}`;
  const [dstSteps] = await db
    .select({ total: dsql<number>`coalesce(sum(${schema.healthDays.steps}), 0)::bigint` })
    .from(schema.healthDays)
    .where(
      and(
        eq(schema.healthDays.userId, userId),
        eq(schema.healthDays.provider, MIGRATION_PROVIDER),
        gte(schema.healthDays.date, start),
        lte(schema.healthDays.date, end),
      ),
    );

  const [srcWorkouts] = await source<{ n: number }[]>`
    select count(*)::int as n from activities where clerk_id = ${clerkId}`;
  const [dstWorkouts] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.workouts)
    .where(
      and(eq(schema.workouts.userId, userId), eq(schema.workouts.provider, MIGRATION_PROVIDER)),
    );

  const [srcLabs] = await source<{ n: number }[]>`
    select count(*)::int as n from lab_results r
    join lab_sessions s on s.id = r.session_id where s.clerk_id = ${clerkId}`;
  const [dstLabs] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.labResults)
    .where(eq(schema.labResults.userId, userId));

  const check = (a: number | string, b: number | string) =>
    String(a) === String(b) ? "OK" : "MISMATCH";
  log(`  steps ${start}..${end}: origin=${srcSteps.total} pulso=${dstSteps.total} ${check(srcSteps.total, dstSteps.total)}`);
  log(`  workouts: origin=${srcWorkouts.n} pulso=${dstWorkouts.n} ${check(srcWorkouts.n, dstWorkouts.n)}`);
  log(`  lab_results: origin=${srcLabs.n} pulso=${dstLabs.n} ${check(srcLabs.n, dstLabs.n)}`);
}

/* ------------------------------------------------------------------ */

function printStats(stats: TableStat[], dryRun: boolean): void {
  const width = Math.max(...stats.map((s) => s.table.length)) + 2;
  for (const s of stats) {
    const line = dryRun
      ? `  ${s.table.padEnd(width)} ${s.source} rows to migrate`
      : `  ${s.table.padEnd(width)} source=${s.source} migrated=${s.migrated} skipped=${s.skipped}`;
    log(line);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mainUrl) {
    log("note: --main-url accepted but unused — every migrated table lives in the Garmin DB");
  }
  const source = postgres(args.sourceUrl, { max: 4, prepare: false });
  const db = getDb();
  const cutoff = samplesCutoff(args.samplesDays);
  if (cutoff) log(`intraday samples limited to date >= ${cutoff} (--samples-days)`);

  try {
    // Every pulso user in the map must exist before writing anything.
    for (const [clerkId, userId] of args.users) {
      const [found] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!found) {
        throw new Error(`pulso user ${userId} (mapped from ${clerkId}) does not exist — create the account first`);
      }
    }

    if (!args.yes) {
      log("DRY RUN (no writes). Re-run with --yes to migrate.\n");
      for (const [clerkId, userId] of args.users) {
        log(`user ${clerkId} → ${userId}`);
        printStats(await planUser(source, clerkId, cutoff), true);
        log("");
      }
      return;
    }

    for (const [clerkId, userId] of args.users) {
      log(`migrating ${clerkId} → ${userId}`);
      printStats(await migrateUser(source, db, clerkId, userId, cutoff), false);
      log("verification:");
      await verifyUser(source, db, clerkId, userId);
      log("");
    }
    log("migration complete");
  } finally {
    await source.end({ timeout: 5 });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
