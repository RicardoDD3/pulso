/**
 * The authorization safety net (spec doc 12 §2), against a real Postgres:
 * (a) a foreign viewer without a grant reads nothing (404),
 * (b) with a grant, only granted scopes,
 * (c) write repos reject grant viewers,
 * (d) user-deletion cascade leaves zero orphans.
 */
import { setupTestDb, truncateAll, createTestUser } from "./setup";
import type { Viewer } from "@/lib/authz/viewer";

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

function ownerViewer(userId: string): Viewer {
  return { userId, effectiveUserId: userId, grant: null };
}

describe("viewer resolution with grants", () => {
  it("foreign viewAs without a grant → 404 AuthzError", async () => {
    const { resolveViewerForUser } = await import("@/lib/authz/viewer");
    const { AuthzError } = await import("@/lib/authz/viewer");
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    await expect(resolveViewerForUser(bob, alice)).rejects.toThrow(AuthzError);
    await expect(resolveViewerForUser(bob, alice)).rejects.toMatchObject({ status: 404 });
  });

  it("pending (not accepted) grants do NOT authorize", async () => {
    const { resolveViewerForUser } = await import("@/lib/authz/viewer");
    const grantsRepo = await import("@/lib/db/repos/grants");
    const { getDb, schema } = await import("@/lib/db");
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    const [bobRow] = await getDb().select().from(schema.users);
    void bobRow;
    const [{ email }] = await getDb()
      .select({ email: schema.users.email })
      .from(schema.users)
      .then((rows) => rows.filter((r) => r.email.startsWith("bob")));
    await grantsRepo.createGrant(ownerViewer(alice), email, ["health"]);
    await expect(resolveViewerForUser(bob, alice)).rejects.toMatchObject({ status: 404 });
  });

  it("active grant authorizes only its scopes; revoke is immediate; reads are audited", async () => {
    const { resolveViewerForUser, AuthzError } = await import("@/lib/authz/viewer");
    const grantsRepo = await import("@/lib/db/repos/grants");
    const exercisesRepo = await import("@/lib/db/repos/exercises");
    const labsRepo = await import("@/lib/db/repos/labs");
    const { getDb, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");

    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    const [bobEmailRow] = await getDb()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, bob));
    const grant = await grantsRepo.createGrant(ownerViewer(alice), bobEmailRow.email, [
      "exercises",
    ]);
    await grantsRepo.acceptGrant(ownerViewer(bob), grant.id);

    const bobViewingAlice = await resolveViewerForUser(bob, alice);
    expect(bobViewingAlice.effectiveUserId).toBe(alice);
    expect(bobViewingAlice.grant).not.toBeNull();

    // In-scope read works (returns Alice's — empty — data, not an error).
    const logs = await exercisesRepo.listLogs(bobViewingAlice, { date: "2026-01-01" });
    expect(logs).toEqual([]);

    // Out-of-scope read → 404.
    await expect(labsRepo.listSessions(bobViewingAlice)).rejects.toThrow(AuthzError);

    // Audit rows were written for the grant read resolution.
    const audit = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "grant_read"));
    expect(audit.length).toBeGreaterThan(0);

    // Revoke → immediate 404 on next resolution.
    await grantsRepo.revokeGrant(ownerViewer(alice), grant.id);
    await expect(resolveViewerForUser(bob, alice)).rejects.toMatchObject({ status: 404 });
  });

  it("write repos reject grant viewers with 403", async () => {
    const { resolveViewerForUser } = await import("@/lib/authz/viewer");
    const grantsRepo = await import("@/lib/db/repos/grants");
    const exercisesRepo = await import("@/lib/db/repos/exercises");
    const { getDb, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");

    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");
    const [bobEmailRow] = await getDb()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, bob));
    const grant = await grantsRepo.createGrant(ownerViewer(alice), bobEmailRow.email, [
      "exercises",
    ]);
    await grantsRepo.acceptGrant(ownerViewer(bob), grant.id);
    const bobViewingAlice = await resolveViewerForUser(bob, alice);

    await expect(
      exercisesRepo.upsertLog(bobViewingAlice, {
        date: "2026-01-01",
        exerciseKey: "sentadillas",
        reps: 10,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      exercisesRepo.createDefinition(bobViewingAlice, {
        label: "X",
        emoji: "x",
        color: "red",
        type: "bodyweight",
        increment: 1,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("data isolation", () => {
  it("each user only ever reads their own rows", async () => {
    const exercisesRepo = await import("@/lib/db/repos/exercises");
    const alice = await createTestUser("Alice");
    const bob = await createTestUser("Bob");

    await exercisesRepo.listDefinitions(ownerViewer(alice)); // seeds Alice
    await exercisesRepo.upsertLog(ownerViewer(alice), {
      date: "2026-01-01",
      exerciseKey: "sentadillas",
      reps: 42,
    });

    const bobLogs = await exercisesRepo.listLogs(ownerViewer(bob), { date: "2026-01-01" });
    expect(bobLogs).toEqual([]);
    const aliceLogs = await exercisesRepo.listLogs(ownerViewer(alice), { date: "2026-01-01" });
    expect(aliceLogs).toHaveLength(1);
  });

  it("seed of defaults is concurrency-safe (two parallel first GETs)", async () => {
    const exercisesRepo = await import("@/lib/db/repos/exercises");
    const alice = await createTestUser("Alice");
    const [a, b] = await Promise.all([
      exercisesRepo.listDefinitions(ownerViewer(alice)),
      exercisesRepo.listDefinitions(ownerViewer(alice)),
    ]);
    expect(a.length).toBe(8);
    expect(b.length).toBe(8);
    const again = await exercisesRepo.listDefinitions(ownerViewer(alice));
    expect(again.length).toBe(8);
  });
});

describe("deletion cascade", () => {
  it("deleting the user leaves zero rows in every data table", async () => {
    const exercisesRepo = await import("@/lib/db/repos/exercises");
    const convRepo = await import("@/lib/db/repos/conversations");
    const { getDb, schema } = await import("@/lib/db");
    const { eq, sql } = await import("drizzle-orm");

    const alice = await createTestUser("Alice");
    const viewer = ownerViewer(alice);
    await exercisesRepo.listDefinitions(viewer);
    await exercisesRepo.upsertLog(viewer, { date: "2026-01-01", exerciseKey: "planks", reps: 3 });
    const conversation = await convRepo.createConversation(viewer, { kind: "coach" });
    await convRepo.saveExchange(viewer, conversation.id, {
      userContent: "hi",
      assistantContent: "hello",
      model: "mock/mock-1",
    });
    await getDb().insert(schema.healthDays).values({
      userId: alice,
      date: "2026-01-01",
      provider: "test",
      steps: 1000,
    });

    await getDb().delete(schema.users).where(eq(schema.users.id, alice));

    for (const table of [
      "profiles",
      "exercise_definitions",
      "exercise_logs",
      "conversations",
      "messages",
      "health_days",
      "sessions",
      "accounts",
    ]) {
      const [row] = await getDb().execute(
        sql.raw(`select count(*)::int as count from ${table}`),
      );
      expect({ table, count: (row as { count: number }).count }).toEqual({ table, count: 0 });
    }
  });
});
