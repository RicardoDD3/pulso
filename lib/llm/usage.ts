/**
 * LLM usage accounting + per-user daily quota (spec doc 05).
 * Quota resets at midnight in the USER's timezone.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { estimateCostUsd } from "./registry";
import type { LlmFeature } from "./types";

export async function recordUsage(input: {
  userId: string;
  feature: LlmFeature;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}) {
  await getDb()
    .insert(schema.llmUsage)
    .values({
      ...input,
      costUsdEstimate: estimateCostUsd(input.model, input.tokensIn, input.tokensOut),
    });
}

/** Start of "today" in the given IANA timezone, as a UTC Date. */
export function startOfTodayInTz(tz: string, now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
  // Find the UTC instant of local midnight by scanning candidate offsets.
  const local = `${y}-${m}-${d}T00:00:00`;
  const guess = new Date(`${local}Z`);
  const offsetMin = tzOffsetMinutes(tz, guess);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

function tzOffsetMinutes(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/** Tokens (in+out) consumed today in the user's tz. */
export async function tokensUsedToday(userId: string, timezone: string): Promise<number> {
  const since = startOfTodayInTz(timezone);
  const [row] = await getDb()
    .select({
      total: sql<number>`coalesce(sum(${schema.llmUsage.tokensIn} + ${schema.llmUsage.tokensOut}), 0)`,
    })
    .from(schema.llmUsage)
    .where(and(eq(schema.llmUsage.userId, userId), gte(schema.llmUsage.createdAt, since)));
  return Number(row?.total ?? 0);
}

/** Throws-free quota check. limit 0 = unlimited. */
export async function isOverQuota(userId: string, timezone: string): Promise<boolean> {
  const limit = getEnv().LLM_DAILY_TOKEN_LIMIT;
  if (!limit) return false;
  const used = await tokensUsedToday(userId, timezone);
  return used >= limit;
}
