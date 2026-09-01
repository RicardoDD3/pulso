/**
 * BullMQ queues (spec doc 01): webhooks/ingestion, PDF extraction and
 * maintenance run OUT of the request path.
 */
import { Queue } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "@/lib/env";

export const QUEUES = {
  labs: "labs",
  ingest: "ingest",
  maintenance: "maintenance",
} as const;

export type LabsJob = { userId: string; sessionId: string; filePath: string; timezone: string };
export type IngestJob = {
  userId: string;
  owUserId: string;
  kind: "webhook" | "reconcile" | "manual" | "backfill";
  eventType?: string;
  windowStart: string;
  windowEnd: string;
};

declare global {
  var __pulsoQueues: Map<string, Queue> | undefined;
  var __pulsoQueueRedis: Redis | undefined;
}

function connection(): Redis {
  if (!globalThis.__pulsoQueueRedis) {
    globalThis.__pulsoQueueRedis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ requirement
    });
  }
  return globalThis.__pulsoQueueRedis;
}

export function getQueue(name: (typeof QUEUES)[keyof typeof QUEUES]): Queue {
  if (!globalThis.__pulsoQueues) globalThis.__pulsoQueues = new Map();
  let q = globalThis.__pulsoQueues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: connection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
    globalThis.__pulsoQueues.set(name, q);
  }
  return q;
}
