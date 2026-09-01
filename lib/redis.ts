import Redis from "ioredis";
import { getEnv } from "@/lib/env";

declare global {
  var __pulsoRedis: Redis | undefined;
}

export function getRedis(): Redis {
  if (!globalThis.__pulsoRedis) {
    globalThis.__pulsoRedis = new Redis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }
  return globalThis.__pulsoRedis;
}
