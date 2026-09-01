/**
 * The Viewer model — core of authorization (spec doc 04).
 *
 * Every authenticated request resolves a Viewer through this module, and every
 * repo requires one. Write repos require an OwnerViewer — a type you can only
 * obtain when grant === null — so a grant can never write, by construction.
 */
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb, schema } from "@/lib/db";

export { GRANT_SCOPES } from "./scopes";
export type { GrantScope } from "./scopes";
import { GRANT_SCOPES } from "./scopes";
import type { GrantScope } from "./scopes";

export type DataGrant = {
  id: string;
  ownerId: string;
  granteeId: string;
  scopes: GrantScope[];
};

export type Viewer = {
  userId: string; // who is logged in
  effectiveUserId: string; // whose data is being read
  grant: DataGrant | null; // non-null ⟺ userId !== effectiveUserId
};

/** A Viewer that is provably the owner of the data (grant === null). */
export type OwnerViewer = Viewer & { grant: null };

export class AuthzError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function isOwner(viewer: Viewer): viewer is OwnerViewer {
  return viewer.grant === null;
}

/**
 * Narrows to OwnerViewer or throws 403. Write paths call this; read-only
 * grant viewers can never reach a write repo.
 */
export function requireOwner(viewer: Viewer): OwnerViewer {
  if (!isOwner(viewer)) throw new AuthzError(403, "read_only_grant");
  return viewer;
}

/** Throws 404 when the grant does not include the scope (owner always passes). */
export function requireScope(viewer: Viewer, scope: GrantScope): void {
  if (viewer.grant && !viewer.grant.scopes.includes(scope)) {
    throw new AuthzError(404, "not_found");
  }
}

/**
 * Resolve the Viewer for the current request.
 *
 * - No viewAs → effectiveUserId = userId (normal path).
 * - viewAs=<userId> → requires an ACTIVE data_grant from that owner to the
 *   session user; otherwise 404 (never 403 — don't reveal the user exists).
 *   Grant access is read-only and audited (one audit row per request).
 */
export async function resolveViewer(viewAs?: string | null): Promise<Viewer> {
  // Dynamic import keeps better-auth (ESM-only) out of pure-logic test paths.
  const { auth } = await import("@/lib/auth");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new AuthzError(401, "unauthenticated");
  return resolveViewerForUser(session.user.id, viewAs);
}

/** Testable core, independent of Next request plumbing. */
export async function resolveViewerForUser(
  userId: string,
  viewAs?: string | null,
): Promise<Viewer> {
  if (!viewAs || viewAs === userId) {
    return { userId, effectiveUserId: userId, grant: null };
  }
  const db = getDb();
  const [grantRow] = await db
    .select()
    .from(schema.dataGrants)
    .where(
      and(
        eq(schema.dataGrants.ownerId, viewAs),
        eq(schema.dataGrants.granteeId, userId),
        eq(schema.dataGrants.status, "active"),
      ),
    )
    .limit(1);
  if (!grantRow) throw new AuthzError(404, "not_found");

  const grant: DataGrant = {
    id: grantRow.id,
    ownerId: grantRow.ownerId,
    granteeId: grantRow.granteeId,
    scopes: grantRow.scopes.filter((s): s is GrantScope =>
      (GRANT_SCOPES as readonly string[]).includes(s),
    ),
  };
  await db.insert(schema.auditLog).values({
    actorId: userId,
    ownerId: viewAs,
    action: "grant_read",
    resource: "request",
  });
  return { userId, effectiveUserId: viewAs, grant };
}
