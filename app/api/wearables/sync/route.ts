import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { getQueue } from "@/lib/queue";
import * as ingest from "@/lib/db/repos/ingest";

/** POST — "Sync now" button (rate-limited; enqueues a manual sync job). */
export const POST = withApi(async () => {
  const viewer = requireOwner(await resolveViewer());
  if (!(await checkRateLimit(viewer.userId, RATE_LIMITS.syncNow))) {
    return apiError(429, "rate_limited");
  }
  const account = await ingest.getWearableAccount(viewer.userId);
  if (!account) return apiError(404, "not_found");
  await getQueue("ingest").add("manual", {
    userId: viewer.userId,
    owUserId: account.owUserId,
    kind: "manual",
    windowStart: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    windowEnd: new Date().toISOString(),
  });
  return ok({ queued: true }, { status: 202 });
});
