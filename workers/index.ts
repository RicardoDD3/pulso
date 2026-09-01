/**
 * Pulso worker process (spec docs 01/03): BullMQ processors for ingestion,
 * lab PDF extraction and maintenance. Run with `npm run worker` (or the
 * pulso-worker compose service).
 */
// Load .env when run outside Next (tsx CLI); no-op if the file is absent.
try {
  process.loadEnvFile(".env");
} catch {
  /* env comes from the environment (compose) */
}

import { Worker } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { QUEUES, getQueue, type IngestJob, type LabsJob } from "@/lib/queue";
import { syncUserWindow } from "@/lib/ow/sync";
import { processLabSession } from "@/lib/labs/process";
import { pruneTrackingMessages } from "@/lib/db/repos/conversations";
import * as ingest from "@/lib/db/repos/ingest";
import { getFeatures } from "@/lib/system/features";

function connection() {
  return new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
}

async function main() {
  const env = getEnv();

  const ingestWorker = new Worker<IngestJob>(
    QUEUES.ingest,
    async (job) => {
      const { userId, owUserId, kind, windowStart, windowEnd } = job.data;
      await syncUserWindow({
        userId,
        owUserId,
        kind,
        window: { start: new Date(windowStart), end: new Date(windowEnd) },
      });
    },
    { connection: connection(), concurrency: 3 },
  );

  const labsWorker = new Worker<LabsJob>(
    QUEUES.labs,
    async (job) => {
      await processLabSession(job.data);
    },
    { connection: connection(), concurrency: 2 },
  );

  const maintenanceWorker = new Worker(
    QUEUES.maintenance,
    async (job) => {
      switch (job.name) {
        case "reconcile": {
          if (!getFeatures().wearablesEnabled) return;
          const accounts = await ingest.listWearableAccounts();
          for (const account of accounts) {
            try {
              await syncUserWindow({
                userId: account.userId,
                owUserId: account.owUserId,
                kind: "reconcile",
                window: { start: new Date(Date.now() - 7 * 86_400_000), end: new Date() },
              });
            } catch (err) {
              logger.warn({ err: err instanceof Error ? err.name : "unknown" }, "reconcile_user_failed");
            }
          }
          break;
        }
        case "prune-tracking":
          await pruneTrackingMessages();
          break;
        case "prune-sync-runs":
          await ingest.pruneSyncRuns();
          break;
        case "prune-samples":
          await ingest.pruneMetricSamples(env.SAMPLES_RETENTION_DAYS);
          break;
      }
    },
    { connection: connection(), concurrency: 1 },
  );

  // Repeatable maintenance jobs (idempotent registration).
  const maintenance = getQueue("maintenance");
  await maintenance.upsertJobScheduler("reconcile", { every: 6 * 3600_000 });
  await maintenance.upsertJobScheduler("prune-tracking", { every: 3600_000 });
  await maintenance.upsertJobScheduler("prune-sync-runs", { every: 24 * 3600_000 });
  await maintenance.upsertJobScheduler("prune-samples", { every: 24 * 3600_000 });

  // Register our webhook endpoint in OW at startup (idempotent — doc 03).
  if (getFeatures().wearablesEnabled) {
    try {
      const { getOwClient } = await import("@/lib/ow/client");
      await getOwClient().registerWebhookEndpoint(`${env.APP_URL}/api/wearables/webhook`);
      logger.info("ow_webhook_registered");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.name : "unknown" }, "ow_webhook_register_failed");
    }
  }

  logger.info("pulso-worker started");

  const shutdown = async () => {
    await Promise.allSettled([
      ingestWorker.close(),
      labsWorker.close(),
      maintenanceWorker.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "worker_boot_failed");
  process.exit(1);
});
