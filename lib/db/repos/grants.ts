/**
 * Data grants repo (spec doc 04): explicit, scoped, revocable athlete→coach
 * read access. Grants never expose chats/settings/export; write repos reject
 * grant viewers at the type level.
 */
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { AuthzError, requireOwner, GRANT_SCOPES, type GrantScope, type Viewer } from "@/lib/authz/viewer";

const { dataGrants, users, auditLog } = schema;

async function audit(actorId: string, ownerId: string, action: string) {
  await getDb().insert(auditLog).values({ actorId, ownerId, action, resource: "data_grant" });
}

/** Grants I gave (as owner) and grants I received (as grantee). */
export async function listGrants(viewer: Viewer) {
  const owner = requireOwner(viewer);
  const db = getDb();
  const rows = await db
    .select({
      id: dataGrants.id,
      ownerId: dataGrants.ownerId,
      granteeId: dataGrants.granteeId,
      scopes: dataGrants.scopes,
      status: dataGrants.status,
      createdAt: dataGrants.createdAt,
      acceptedAt: dataGrants.acceptedAt,
      ownerName: users.name,
    })
    .from(dataGrants)
    .leftJoin(users, eq(users.id, dataGrants.ownerId))
    .where(or(eq(dataGrants.ownerId, owner.userId), eq(dataGrants.granteeId, owner.userId)));
  return {
    given: rows.filter((r) => r.ownerId === owner.userId),
    received: rows.filter((r) => r.granteeId === owner.userId && r.status !== "revoked"),
  };
}

/** Owner shares with a grantee by email. Pending until accepted. */
export async function createGrant(viewer: Viewer, granteeEmail: string, scopes: GrantScope[]) {
  const owner = requireOwner(viewer);
  const validScopes = scopes.filter((s) => GRANT_SCOPES.includes(s));
  if (validScopes.length === 0) throw new AuthzError(403, "invalid_input");
  const db = getDb();
  const [grantee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, granteeEmail.toLowerCase()))
    .limit(1);
  // v1: the grantee account must exist (no SMTP invitations — spec doc 16 #12).
  if (!grantee) throw new AuthzError(404, "not_found");
  if (grantee.id === owner.userId) throw new AuthzError(403, "invalid_input");
  const [grant] = await db
    .insert(dataGrants)
    .values({ ownerId: owner.userId, granteeId: grantee.id, scopes: validScopes, status: "pending" })
    .onConflictDoUpdate({
      target: [dataGrants.ownerId, dataGrants.granteeId],
      set: { scopes: validScopes, status: "pending", revokedAt: null },
    })
    .returning();
  await audit(owner.userId, owner.userId, "grant_created");
  return grant;
}

export async function acceptGrant(viewer: Viewer, grantId: string) {
  const owner = requireOwner(viewer); // "owner" here = the acting user (grantee of the grant)
  const [grant] = await getDb()
    .update(dataGrants)
    .set({ status: "active", acceptedAt: new Date() })
    .where(
      and(
        eq(dataGrants.id, grantId),
        eq(dataGrants.granteeId, owner.userId),
        eq(dataGrants.status, "pending"),
      ),
    )
    .returning();
  if (!grant) throw new AuthzError(404, "not_found");
  await audit(owner.userId, grant.ownerId, "grant_accepted");
  return grant;
}

/** Either side can end a grant: owner revokes, grantee renounces. */
export async function revokeGrant(viewer: Viewer, grantId: string) {
  const owner = requireOwner(viewer);
  const [grant] = await getDb()
    .update(dataGrants)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(dataGrants.id, grantId),
        or(eq(dataGrants.ownerId, owner.userId), eq(dataGrants.granteeId, owner.userId)),
      ),
    )
    .returning();
  if (!grant) throw new AuthzError(404, "not_found");
  await audit(owner.userId, grant.ownerId, "grant_revoked");
  return grant;
}
