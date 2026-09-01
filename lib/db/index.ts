import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "@/lib/env";

/**
 * Single Drizzle client for the app. Route handlers must NOT import this
 * directly — data access goes through lib/db/repos/* which require a Viewer
 * (spec docs 02/04/11).
 */
declare global {
  var __pulsoDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const client = postgres(getEnv().DATABASE_URL, { max: 10 });
  return drizzle(client, { schema });
}

export function getDb() {
  if (!globalThis.__pulsoDb) globalThis.__pulsoDb = createDb();
  return globalThis.__pulsoDb;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
