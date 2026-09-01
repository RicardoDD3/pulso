/**
 * DB test harness: applies migrations to TEST_DATABASE_URL and provides
 * helpers to create users and clean up between tests.
 */
import { execSync } from "node:child_process";
import { sql } from "drizzle-orm";

export function requireTestDb(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for the db test project (use a THROWAWAY database — tables are truncated between tests).",
    );
  }
  return url;
}

export async function setupTestDb() {
  const url = requireTestDb();
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "db-tests-secret-0123456789abcdef";
  execSync("npx drizzle-kit migrate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const { getDb } = await import("@/lib/db");
  return getDb();
}

export async function truncateAll() {
  const { getDb } = await import("@/lib/db");
  await getDb().execute(sql`
    truncate table users cascade
  `);
}

let userCounter = 0;

/** Direct insert (no Better Auth) — enough for repo-level tests. */
export async function createTestUser(name: string): Promise<string> {
  const { getDb, schema } = await import("@/lib/db");
  userCounter++;
  const [user] = await getDb()
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}-${userCounter}@db-test.local` })
    .returning({ id: schema.users.id });
  return user.id;
}
