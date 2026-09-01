/**
 * Profile repo (spec docs 02/04). Profile is 1:1 with users, created lazily.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireOwner, type Viewer } from "@/lib/authz/viewer";

const { profiles } = schema;

export async function getProfile(viewer: Viewer): Promise<typeof profiles.$inferSelect> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, viewer.effectiveUserId))
    .limit(1);
  if (row) return row;
  // Lazy-create with defaults — only for the owner; a grant viewer reading a
  // never-initialized profile just gets defaults without writing.
  if (viewer.grant) {
    return {
      userId: viewer.effectiveUserId,
      displayName: null,
      birthDate: null,
      sex: null,
      maxHr: null,
      timezone: "UTC",
      locale: "en",
      unitSystem: "metric",
      primaryProvider: null,
      role: "user",
    } satisfies typeof profiles.$inferSelect;
  }
  const [created] = await db
    .insert(profiles)
    .values({ userId: viewer.effectiveUserId })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getProfile(viewer));
}

/** Allowlist patch — role is NOT settable here (admin flows only). */
export async function updateProfile(
  viewer: Viewer,
  patch: Partial<{
    displayName: string | null;
    birthDate: string | null;
    sex: string | null;
    maxHr: number | null;
    timezone: string;
    locale: string;
    unitSystem: string;
    primaryProvider: string | null;
  }>,
) {
  const owner = requireOwner(viewer);
  await getProfile(owner); // ensure row exists
  const [row] = await getDb()
    .update(profiles)
    .set(patch)
    .where(eq(profiles.userId, owner.userId))
    .returning();
  return row;
}
