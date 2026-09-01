/**
 * Per-user rate limiting via Redis fixed window (spec docs 05/11).
 * Fails OPEN on Redis errors (availability over strictness for self-host),
 * except when RATE_LIMIT_DISABLED=true which skips entirely (dev only).
 */
import { getRedis } from "@/lib/redis";
import { envFlags } from "@/lib/env";
import { logger } from "@/lib/logger";

export type RateLimitRule = { key: string; limit: number; windowS: number };

export const RATE_LIMITS = {
  chat: { key: "chat", limit: 20, windowS: 60 },
  labsUpload: { key: "labs-upload", limit: 3, windowS: 3600 },
  syncNow: { key: "sync-now", limit: 4, windowS: 3600 },
  fitUpload: { key: "fit-upload", limit: 20, windowS: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export async function checkRateLimit(userId: string, rule: RateLimitRule): Promise<boolean> {
  if (envFlags.rateLimitDisabled()) return true;
  try {
    const redis = getRedis();
    const bucket = Math.floor(Date.now() / (rule.windowS * 1000));
    const key = `ratelimit:${rule.key}:${userId}:${bucket}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rule.windowS);
    return count <= rule.limit;
  } catch (err) {
    logger.warn({ err, rule: rule.key }, "rate_limit_redis_unavailable");
    return true;
  }
}
