/**
 * TTL memo for chat system prompts (ported pattern from the original's
 * prompt-cache.ts; spec doc 05).
 *
 * WHY: provider prompt caching is an exact PREFIX match. The health context is
 * rebuilt from ~10 live queries per message, so it changed between messages
 * and no provider could ever cache it. With this memo, consecutive messages
 * share a byte-identical prompt and hit the provider cache (reads at ~10% of
 * price), plus we skip the context queries entirely.
 *
 * Pulso difference: the memo lives in REDIS, not process memory — the original
 * documented that the in-process memo dies on cold serverless starts. A local
 * Map remains as fallback so tests and Redis-less dev still work.
 *
 * TRADE-OFF: up to 5 minutes of staleness — acceptable because the chats
 * analyze history, not live telemetry.
 */
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/** Anthropic/OpenAI provider cache window: 5 minutes. */
export const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry {
  prompt: string;
  expiresAt: number;
}

const local = new Map<string, Entry>();

/**
 * Memo key. Includes the day IN THE USER'S TIMEZONE because the prompt embeds
 * "TODAY" and the current plan week: when the day flips, the previous entry is
 * invalid even if not yet expired.
 */
export function promptCacheKey(dataUserId: string, feature: string, today: string): string {
  return `promptmemo:${dataUserId}|${feature}|${today}`;
}

export async function getCachedPrompt(key: string, now: number): Promise<string | null> {
  const entry = local.get(key);
  if (entry) {
    if (now < entry.expiresAt) return entry.prompt;
    local.delete(key);
  }
  try {
    const value = await getRedis().get(key);
    if (value != null) {
      local.set(key, { prompt: value, expiresAt: now + 30_000 });
      return value;
    }
  } catch (err) {
    logger.debug({ err }, "prompt_cache_redis_miss");
  }
  return null;
}

export async function setCachedPrompt(key: string, prompt: string, now: number): Promise<void> {
  for (const [k, entry] of local) {
    if (now >= entry.expiresAt) local.delete(k);
  }
  local.set(key, { prompt, expiresAt: now + PROMPT_CACHE_TTL_MS });
  try {
    await getRedis().set(key, prompt, "PX", PROMPT_CACHE_TTL_MS);
  } catch (err) {
    logger.debug({ err }, "prompt_cache_redis_set_failed");
  }
}

/** Tests only. */
export function clearPromptCache(): void {
  local.clear();
}
