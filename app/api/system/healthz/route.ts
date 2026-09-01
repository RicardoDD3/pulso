import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness/readiness probe (spec doc 01). */
export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};
  let healthy = true;
  try {
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 },
  );
}
