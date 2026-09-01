/**
 * Labs repo (spec docs 02/07/08). Reads allow grant scope `labs`; writes and
 * PDF access are owner-only. Result reads are bound by (session_id AND
 * user_id) — never session_id alone (spec doc 06).
 */
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireOwner, requireScope, type Viewer } from "@/lib/authz/viewer";

const { labSessions, labResults } = schema;

/** Plain session rows, newest sample first (coach context uses this). */
export async function listSessions(viewer: Viewer, limit = 50) {
  requireScope(viewer, "labs");
  return getDb()
    .select()
    .from(labSessions)
    .where(eq(labSessions.userId, viewer.effectiveUserId))
    .orderBy(desc(labSessions.sampleDate))
    .limit(Math.min(limit, 200));
}

/** Sessions with result/flag counts (the sessions list UI uses this). */
export async function listSessionsWithCounts(viewer: Viewer) {
  requireScope(viewer, "labs");
  return getDb()
    .select({
      session: labSessions,
      resultCount: sql<number>`count(${labResults.id})::int`,
      flagCount: sql<number>`count(${labResults.id}) filter (where ${labResults.isFlagged})::int`,
    })
    .from(labSessions)
    .leftJoin(labResults, eq(labResults.sessionId, labSessions.id))
    .where(eq(labSessions.userId, viewer.effectiveUserId))
    .groupBy(labSessions.id)
    .orderBy(desc(labSessions.sampleDate), desc(labSessions.createdAt));
}

export async function sessionResults(viewer: Viewer, sessionId: string) {
  requireScope(viewer, "labs");
  return getDb()
    .select()
    .from(labResults)
    .where(
      and(
        eq(labResults.sessionId, sessionId),
        eq(labResults.userId, viewer.effectiveUserId),
      ),
    )
    .orderBy(asc(labResults.category), asc(labResults.testName));
}

export async function getSession(viewer: Viewer, sessionId: string) {
  requireScope(viewer, "labs");
  const [session] = await getDb()
    .select()
    .from(labSessions)
    .where(
      and(eq(labSessions.id, sessionId), eq(labSessions.userId, viewer.effectiveUserId)),
    )
    .limit(1);
  if (!session) return null;
  const results = await sessionResults(viewer, sessionId);
  return { session, results };
}

export async function createProcessingSession(viewer: Viewer, sourceFilePath: string) {
  const owner = requireOwner(viewer);
  const [session] = await getDb()
    .insert(labSessions)
    .values({ userId: owner.userId, status: "processing", sourceFilePath })
    .returning();
  return session;
}

export async function markSessionFailed(userId: string, sessionId: string, error: string) {
  await getDb()
    .update(labSessions)
    .set({ status: "failed", error })
    .where(and(eq(labSessions.id, sessionId), eq(labSessions.userId, userId)));
}

/** Transactional write of a completed extraction (spec doc 11 M4). */
export async function completeSession(
  userId: string,
  sessionId: string,
  data: {
    sampleDate: string | null;
    labName: string | null;
    labLocation: string | null;
    patientName: string | null;
    patientDob: string | null;
    patientSex: string | null;
    patientAge: string | null;
    doctorName: string | null;
    extractionModel: string;
    results: Array<{
      category: string;
      testName: string;
      testNameNormalized: string | null;
      valueNum: number | null;
      valueText: string | null;
      unit: string | null;
      refLow: number | null;
      refHigh: number | null;
      refText: string | null;
      isFlagged: boolean;
    }>;
  },
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .update(labSessions)
      .set({
        status: "completed",
        error: null,
        sampleDate: data.sampleDate,
        labName: data.labName,
        labLocation: data.labLocation,
        patientName: data.patientName,
        patientDob: data.patientDob,
        patientSex: data.patientSex,
        patientAge: data.patientAge,
        doctorName: data.doctorName,
        extractionModel: data.extractionModel,
      })
      .where(and(eq(labSessions.id, sessionId), eq(labSessions.userId, userId)))
      .returning();
    if (!session) throw new Error("session_missing");
    // Retry path: replace previous results atomically.
    await tx.delete(labResults).where(eq(labResults.sessionId, sessionId));
    if (data.results.length > 0) {
      await tx
        .insert(labResults)
        .values(data.results.map((r) => ({ sessionId, userId, ...r })));
    }
  });
}

export async function deleteSession(viewer: Viewer, sessionId: string) {
  const owner = requireOwner(viewer);
  const deleted = await getDb()
    .delete(labSessions)
    .where(and(eq(labSessions.id, sessionId), eq(labSessions.userId, owner.userId)))
    .returning({ id: labSessions.id, sourceFilePath: labSessions.sourceFilePath });
  return deleted[0] ?? null;
}

/** Series for one normalized analyte across sessions (trend view). */
export async function analyteTrend(viewer: Viewer, testKey: string) {
  requireScope(viewer, "labs");
  return getDb()
    .select({
      sessionId: labResults.sessionId,
      sampleDate: labSessions.sampleDate,
      valueNum: labResults.valueNum,
      unit: labResults.unit,
      refLow: labResults.refLow,
      refHigh: labResults.refHigh,
      isFlagged: labResults.isFlagged,
      testName: labResults.testName,
    })
    .from(labResults)
    .innerJoin(labSessions, eq(labSessions.id, labResults.sessionId))
    .where(
      and(
        eq(labResults.userId, viewer.effectiveUserId),
        eq(labResults.testNameNormalized, testKey),
        isNotNull(labResults.valueNum),
      ),
    )
    .orderBy(asc(labSessions.sampleDate));
}

/**
 * Historically flagged results across every session (newest sample first) —
 * feeds the "alterados históricos" part of the coach LABS block (doc 08 §10).
 */
export async function flaggedHistory(viewer: Viewer, limit = 200) {
  requireScope(viewer, "labs");
  return getDb()
    .select({
      sessionId: labResults.sessionId,
      sampleDate: labSessions.sampleDate,
      category: labResults.category,
      testName: labResults.testName,
      testNameNormalized: labResults.testNameNormalized,
      valueNum: labResults.valueNum,
      valueText: labResults.valueText,
      unit: labResults.unit,
      refLow: labResults.refLow,
      refHigh: labResults.refHigh,
      refText: labResults.refText,
    })
    .from(labResults)
    .innerJoin(labSessions, eq(labSessions.id, labResults.sessionId))
    .where(
      and(eq(labResults.userId, viewer.effectiveUserId), eq(labResults.isFlagged, true)),
    )
    .orderBy(desc(labSessions.sampleDate))
    .limit(Math.min(limit, 500));
}
