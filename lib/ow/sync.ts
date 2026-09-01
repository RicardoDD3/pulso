/**
 * Sync orchestration (spec doc 03): pull a time window from OW, normalize,
 * upsert into canonical tables, record the run in sync_runs. Called from
 * BullMQ workers — never inline in a request.
 *
 * The webhook payload is NEVER the data source: jobs re-pull the affected
 * window from the OW API.
 */
import { getOwClient } from "@/lib/ow/client";
import {
  normalizeBodyMeasurement,
  normalizeHealthDay,
  normalizeMetricSamples,
  normalizeProviderScores,
  normalizeSleepSession,
  normalizeWorkout,
  localDateOf,
} from "@/lib/ow/normalize";
import * as ingest from "@/lib/db/repos/ingest";
import { logger } from "@/lib/logger";

const SAMPLE_SERIES = [
  "heart_rate",
  "garmin_stress_level",
  "garmin_body_battery",
  "oxygen_saturation",
  "respiratory_rate",
];

export type SyncWindow = { start: Date; end: Date };

export async function syncUserWindow(input: {
  userId: string;
  owUserId: string;
  kind: "webhook" | "reconcile" | "manual" | "backfill";
  window: SyncWindow;
}): Promise<{ rowsUpserted: number }> {
  const { userId, owUserId, kind, window } = input;
  const ow = getOwClient();
  const runId = await ingest.startSyncRun({
    userId,
    provider: null,
    kind,
    windowStart: window.start,
    windowEnd: window.end,
  });

  let rows = 0;
  try {
    // Daily summaries → health_days (activity + sleep + recovery merged per day).
    const [activity, sleepSummaries, recovery] = await Promise.all([
      ow.getDailySummaries(owUserId, "activity", window),
      ow.getDailySummaries(owUserId, "sleep", window),
      ow.getDailySummaries(owUserId, "recovery", window),
    ]);
    const sleepByKey = new Map(sleepSummaries.map((s) => [`${s.date} ${s.source.provider}`, s]));
    const recoveryByKey = new Map(recovery.map((r) => [`${r.date} ${r.source.provider}`, r]));
    rows += await ingest.upsertHealthDays(
      activity.map((a) =>
        normalizeHealthDay(userId, a, {
          sleep: sleepByKey.get(`${a.date} ${a.source.provider}`),
          recovery: recoveryByKey.get(`${a.date} ${a.source.provider}`),
        }),
      ),
    );

    // Events.
    const [workouts, sleepSessions] = await Promise.all([
      ow.listWorkouts(owUserId, window),
      ow.listSleepSessions(owUserId, window),
    ]);
    rows += await ingest.upsertWorkouts(workouts.map((w) => normalizeWorkout(userId, w)));
    rows += await ingest.upsertSleepSessions(
      sleepSessions.map((s) => normalizeSleepSession(userId, s)),
    );

    // Intraday series (metric_samples).
    const samples = await ow.getTimeseries(owUserId, SAMPLE_SERIES, window, "raw");
    rows += await ingest.upsertMetricSamples(normalizeMetricSamples(userId, samples));

    // Provider/OW health scores.
    const scores = await ow.getHealthScores(owUserId, { window });
    rows += await ingest.upsertProviderScores(normalizeProviderScores(userId, scores));

    // Body snapshot (OW exposes latest summary; store it dated by fetch).
    const body = await ow.getBodySummary(owUserId);
    if (body) {
      const normalized = normalizeBodyMeasurement(userId, body, new Date());
      if (normalized) rows += await ingest.upsertBodyMeasurements([normalized]);
    }

    // Refresh connection cache for the settings UI.
    const connections = await ow.listConnections(owUserId);
    await ingest.refreshConnectionsCache(
      userId,
      connections.map((c) => ({
        provider: c.provider,
        status: c.status ?? "connected",
        connectedAt: c.created_at ? new Date(c.created_at) : null,
        lastSyncedAt: c.last_synced_at ? new Date(c.last_synced_at) : new Date(),
        detail: c,
      })),
    );

    await ingest.finishSyncRun(runId, "ok", rows);
    logger.info({ userId, kind, rows }, "sync_ok");
    return { rowsUpserted: rows };
  } catch (err) {
    await ingest.finishSyncRun(
      runId,
      "error",
      rows,
      err instanceof Error ? err.name : "unknown",
    );
    logger.warn({ userId, kind, err }, "sync_failed");
    throw err;
  }
}

/** Default windows per job kind. */
export function windowFor(kind: "webhook" | "reconcile" | "manual" | "backfill"): SyncWindow {
  const end = new Date();
  const days = kind === "backfill" ? 365 : kind === "reconcile" ? 7 : 3;
  return { start: new Date(end.getTime() - days * 86_400_000), end };
}

export { localDateOf };
