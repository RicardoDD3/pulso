/**
 * Account deletion (spec doc 04): delete on the OW side first (tokens + data),
 * then the local user row — the ON DELETE CASCADE FKs remove everything else.
 * Upload files are removed in the same flow. The event is audited (actor id
 * only, no data).
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getFeatures } from "@/lib/system/features";
import { logger } from "@/lib/logger";
import type { OwnerViewer } from "@/lib/authz/viewer";

export async function deleteAccount(viewer: OwnerViewer): Promise<void> {
  const db = getDb();
  const userId = viewer.userId;

  // 1. OW side first (best-effort — the local delete must not be blocked by
  //    an unreachable OW; the reconcile loop can't resurrect a deleted user).
  if (getFeatures().wearablesEnabled) {
    try {
      const [account] = await db
        .select()
        .from(schema.wearableAccounts)
        .where(eq(schema.wearableAccounts.userId, userId))
        .limit(1);
      if (account) {
        const { getOwClient } = await import("@/lib/ow/client");
        await getOwClient().deleteUser(account.owUserId);
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.name : "unknown" }, "ow_delete_failed");
    }
  }

  // 2. Uploaded files.
  try {
    await rm(path.join(getEnv().UPLOADS_DIR, userId), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : "unknown" }, "uploads_delete_failed");
  }

  // 3. Audit BEFORE the row disappears (audit_log has no FK on actor).
  await db.insert(schema.auditLog).values({
    actorId: userId,
    ownerId: userId,
    action: "account_deleted",
    resource: "user",
  });

  // 4. The user row — cascades take everything else.
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}
