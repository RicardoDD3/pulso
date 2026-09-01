/**
 * Ingestion repo (spec doc 03): idempotent upserts into the canonical tables,
 * keyed by natural keys — reprocessing a webhook never duplicates. Used ONLY
 * by workers/sync (system context, explicit userId), never by request paths.
 */
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type {
  NormalizedBodyMeasurement,
  NormalizedHealthDay,
  NormalizedMetricSample,
  NormalizedProviderScores,
  NormalizedSleepSession,
  NormalizedWorkout,
} from "@/lib/ow/normalize";

const {
  healthDays,
  sleepSessions,
  bodyMeasurements,
  workouts,
  metricSamples,
  providerScores,
  syncRuns,
  wearableConnections,
} = schema;

export async function upsertHealthDays(rows: NormalizedHealthDay[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(healthDays)
      .values(row)
      .onConflictDoUpdate({
        target: [healthDays.userId, healthDays.date, healthDays.provider],
        set: {
          steps: row.steps,
          floors: row.floors,
          intensityMinutes: row.intensityMinutes,
          distanceM: row.distanceM,
          caloriesTotal: row.caloriesTotal,
          caloriesActive: row.caloriesActive,
          restingHr: row.restingHr,
          hrMin: row.hrMin,
          hrMax: row.hrMax,
          stressAvg: row.stressAvg,
          stressMax: row.stressMax,
          bodyBatteryHigh: row.bodyBatteryHigh,
          bodyBatteryLow: row.bodyBatteryLow,
          spo2Avg: row.spo2Avg,
          respirationAvg: row.respirationAvg,
          hrvMs: row.hrvMs,
          hrvStatus: row.hrvStatus,
          hydrationMl: row.hydrationMl,
          raw: row.raw,
        },
      });
  }
  return rows.length;
}

export async function upsertSleepSessions(rows: NormalizedSleepSession[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(sleepSessions)
      .values(row)
      .onConflictDoUpdate({
        target: [sleepSessions.userId, sleepSessions.provider, sleepSessions.externalId],
        set: {
          startAt: row.startAt,
          endAt: row.endAt,
          totalMin: row.totalMin,
          inBedMin: row.inBedMin,
          efficiency: row.efficiency,
          deepMin: row.deepMin,
          lightMin: row.lightMin,
          remMin: row.remMin,
          awakeMin: row.awakeMin,
          score: row.score,
          isNap: row.isNap,
          raw: row.raw,
        },
      });
  }
  return rows.length;
}

export async function upsertWorkouts(rows: NormalizedWorkout[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(workouts)
      .values(row)
      .onConflictDoUpdate({
        target: [workouts.userId, workouts.provider, workouts.externalId],
        set: {
          sport: row.sport,
          name: row.name,
          startAt: row.startAt,
          durationS: row.durationS,
          movingS: row.movingS,
          distanceM: row.distanceM,
          calories: row.calories,
          hrAvg: row.hrAvg,
          hrMax: row.hrMax,
          hrMin: row.hrMin,
          elevationGainM: row.elevationGainM,
          speedAvgMps: row.speedAvgMps,
          speedMaxMps: row.speedMaxMps,
          powerAvgW: row.powerAvgW,
          powerMaxW: row.powerMaxW,
          cadenceAvg: row.cadenceAvg,
          raw: row.raw,
        },
      });
  }
  return rows.length;
}

export async function upsertBodyMeasurements(rows: NormalizedBodyMeasurement[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(bodyMeasurements)
      .values(row)
      .onConflictDoUpdate({
        target: [bodyMeasurements.userId, bodyMeasurements.provider, bodyMeasurements.measuredAt],
        set: {
          weightKg: row.weightKg,
          bmi: row.bmi,
          bodyFatPct: row.bodyFatPct,
          muscleMassKg: row.muscleMassKg,
          bodyWaterPct: row.bodyWaterPct,
          boneMassKg: row.boneMassKg,
          raw: row.raw,
        },
      });
  }
  return rows.length;
}

export async function upsertMetricSamples(rows: NormalizedMetricSample[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  // Batched insert with DO NOTHING — samples are immutable points.
  const BATCH = 1000;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db.insert(metricSamples).values(chunk).onConflictDoNothing();
    upserted += chunk.length;
  }
  return upserted;
}

export async function upsertProviderScores(rows: NormalizedProviderScores[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(providerScores)
      .values(row)
      .onConflictDoUpdate({
        target: [providerScores.userId, providerScores.date, providerScores.provider],
        set: { scores: row.scores },
      });
  }
  return rows.length;
}

export async function refreshConnectionsCache(
  userId: string,
  connections: Array<{
    provider: string;
    status: string;
    connectedAt: Date | null;
    lastSyncedAt: Date | null;
    detail: unknown;
  }>,
) {
  const db = getDb();
  for (const c of connections) {
    await db
      .insert(wearableConnections)
      .values({ userId, ...c })
      .onConflictDoUpdate({
        target: [wearableConnections.userId, wearableConnections.provider],
        set: {
          status: c.status,
          connectedAt: c.connectedAt,
          lastSyncedAt: c.lastSyncedAt,
          detail: c.detail,
        },
      });
  }
}

export async function startSyncRun(input: {
  userId: string;
  provider: string | null;
  kind: "webhook" | "reconcile" | "manual" | "backfill";
  windowStart: Date;
  windowEnd: Date;
}) {
  const [run] = await getDb()
    .insert(syncRuns)
    .values({ ...input, status: "running" })
    .returning({ id: syncRuns.id });
  return run.id;
}

export async function finishSyncRun(id: string, status: "ok" | "error", rowsUpserted: number, error?: string) {
  await getDb()
    .update(syncRuns)
    .set({ status, rowsUpserted, error: error ?? null, finishedAt: new Date() })
    .where(eq(syncRuns.id, id));
}

/** Prune sync_runs older than 90 days (spec doc 02). */
export async function pruneSyncRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  await getDb().delete(syncRuns).where(lt(syncRuns.startedAt, cutoff));
}

/** Optional intraday sample retention (SAMPLES_RETENTION_DAYS; 0 = infinite). */
export async function pruneMetricSamples(retentionDays: number): Promise<void> {
  if (!retentionDays) return;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  await getDb().delete(metricSamples).where(lt(metricSamples.recordedAt, cutoff));
}

/** Users with a wearable account, for reconciliation sweeps. */
export async function listWearableAccounts() {
  return getDb()
    .select({
      userId: schema.wearableAccounts.userId,
      owUserId: schema.wearableAccounts.owUserId,
    })
    .from(schema.wearableAccounts);
}

export async function getWearableAccount(userId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.wearableAccounts)
    .where(eq(schema.wearableAccounts.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getWearableAccountByOwUserId(owUserId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.wearableAccounts)
    .where(eq(schema.wearableAccounts.owUserId, owUserId))
    .limit(1);
  return row ?? null;
}

export async function createWearableAccount(userId: string, owUserId: string) {
  const [row] = await getDb()
    .insert(schema.wearableAccounts)
    .values({ userId, owUserId })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  return getWearableAccount(userId);
}

/** Wipe one provider's canonical data for a user (disconnect+delete flow). */
export async function deleteProviderRows(userId: string, provider: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(healthDays).where(and(eq(healthDays.userId, userId), eq(healthDays.provider, provider)));
    await tx.delete(sleepSessions).where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.provider, provider)));
    await tx.delete(bodyMeasurements).where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.provider, provider)));
    await tx.delete(metricSamples).where(and(eq(metricSamples.userId, userId), eq(metricSamples.provider, provider)));
    await tx.delete(providerScores).where(and(eq(providerScores.userId, userId), eq(providerScores.provider, provider)));
    // Workouts cascade to laps/route/zones/weather via FK.
    await tx.delete(workouts).where(and(eq(workouts.userId, userId), eq(workouts.provider, provider)));
    await tx
      .delete(wearableConnections)
      .where(and(eq(wearableConnections.userId, userId), eq(wearableConnections.provider, provider)));
  });
}
