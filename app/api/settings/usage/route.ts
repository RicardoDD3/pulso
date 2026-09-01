import { and, eq, gte, sql } from "drizzle-orm";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { tokensUsedToday } from "@/lib/llm/usage";
import * as profilesRepo from "@/lib/db/repos/profiles";

/** GET — the viewer's own LLM usage: today vs quota + 30-day cost estimate. */
export const GET = withApi(async () => {
  const viewer = requireOwner(await resolveViewer());
  const profile = await profilesRepo.getProfile(viewer);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [byModel, todayTokens] = await Promise.all([
    getDb()
      .select({
        model: schema.llmUsage.model,
        feature: schema.llmUsage.feature,
        tokensIn: sql<number>`sum(${schema.llmUsage.tokensIn})::bigint`,
        tokensOut: sql<number>`sum(${schema.llmUsage.tokensOut})::bigint`,
        tokensCached: sql<number>`sum(${schema.llmUsage.tokensCached})::bigint`,
        costUsd: sql<number>`coalesce(sum(${schema.llmUsage.costUsdEstimate}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(schema.llmUsage)
      .where(and(eq(schema.llmUsage.userId, viewer.userId), gte(schema.llmUsage.createdAt, since)))
      .groupBy(schema.llmUsage.model, schema.llmUsage.feature),
    tokensUsedToday(viewer.userId, profile.timezone),
  ]);
  return ok({
    last30Days: byModel,
    today: { tokens: todayTokens, limit: getEnv().LLM_DAILY_TOKEN_LIMIT || null },
  });
});
