/**
 * Exercises repo (spec docs 02/10). Every function requires a Viewer and
 * scopes by viewer.effectiveUserId; writes require an OwnerViewer.
 * Catalog has NO hard delete — hiding is is_active=false (original policy).
 */
import { and, asc, desc, eq, gt, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireOwner, requireScope, type Viewer } from "@/lib/authz/viewer";
import { DEFAULT_EXERCISES, type ExerciseType } from "@/lib/exercises/defaults";
import { generateExerciseKey } from "@/lib/exercises/keys";

const { exerciseDefinitions, exerciseLogs, exerciseSets } = schema;

/** Seeds the 8 defaults exactly once (ON CONFLICT DO NOTHING → concurrency-safe). */
async function seedDefaultsIfEmpty(userId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: exerciseDefinitions.id })
    .from(exerciseDefinitions)
    .where(and(eq(exerciseDefinitions.userId, userId), eq(exerciseDefinitions.isActive, true)))
    .limit(1);
  if (existing.length > 0) return;
  await db
    .insert(exerciseDefinitions)
    .values(DEFAULT_EXERCISES.map((ex) => ({ userId, ...ex, isActive: true })))
    .onConflictDoNothing();
}

export async function listDefinitions(viewer: Viewer, opts?: { includeInactive?: boolean }) {
  requireScope(viewer, "exercises");
  const userId = viewer.effectiveUserId;
  if (!viewer.grant) await seedDefaultsIfEmpty(userId);
  const db = getDb();
  const where = opts?.includeInactive
    ? eq(exerciseDefinitions.userId, userId)
    : and(eq(exerciseDefinitions.userId, userId), eq(exerciseDefinitions.isActive, true));
  return db.select().from(exerciseDefinitions).where(where).orderBy(asc(exerciseDefinitions.sortOrder));
}

/** Last weight used per weighted exercise (fallback query of the original). */
export async function lastWeights(viewer: Viewer): Promise<Record<string, number>> {
  requireScope(viewer, "exercises");
  const db = getDb();
  const rows = await db
    .select({
      exerciseKey: exerciseSets.exerciseKey,
      weightKg: exerciseSets.weightKg,
    })
    .from(exerciseSets)
    .where(and(eq(exerciseSets.userId, viewer.effectiveUserId), gt(exerciseSets.weightKg, 0)))
    .orderBy(asc(exerciseSets.exerciseKey), desc(exerciseSets.date), desc(exerciseSets.setNumber));
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!(row.exerciseKey in out) && row.weightKg != null) out[row.exerciseKey] = row.weightKg;
  }
  return out;
}

export async function createDefinition(
  viewer: Viewer,
  input: { label: string; emoji: string; color: string; type: ExerciseType; increment: number },
) {
  const owner = requireOwner(viewer);
  const db = getDb();
  const existing = await db
    .select({ exerciseKey: exerciseDefinitions.exerciseKey, sortOrder: exerciseDefinitions.sortOrder })
    .from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.userId, owner.userId));
  const exerciseKey = generateExerciseKey(
    input.label,
    existing.map((r) => r.exerciseKey),
  );
  if (!exerciseKey) return null;
  const sortOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1;
  const [definition] = await db
    .insert(exerciseDefinitions)
    .values({ userId: owner.userId, exerciseKey, isActive: true, sortOrder, ...input })
    .returning();
  return definition;
}

/** Allowlist update (spec doc 11 M1) — id AND user_id in the WHERE itself. */
export async function updateDefinition(
  viewer: Viewer,
  id: string,
  patch: Partial<{
    label: string;
    emoji: string;
    color: string;
    increment: number;
    weeklyGoal: number | null;
    isActive: boolean;
    sortOrder: number;
  }>,
) {
  const owner = requireOwner(viewer);
  const [row] = await getDb()
    .update(exerciseDefinitions)
    .set(patch)
    .where(and(eq(exerciseDefinitions.id, id), eq(exerciseDefinitions.userId, owner.userId)))
    .returning();
  return row ?? null;
}

export async function listLogs(
  viewer: Viewer,
  range: { date?: string; from?: string; to?: string },
) {
  requireScope(viewer, "exercises");
  const db = getDb();
  const userId = viewer.effectiveUserId;
  const conditions = [eq(exerciseLogs.userId, userId)];
  if (range.date) conditions.push(eq(exerciseLogs.date, range.date));
  else if (range.from && range.to) {
    conditions.push(gte(exerciseLogs.date, range.from), lte(exerciseLogs.date, range.to));
  }
  return db
    .select()
    .from(exerciseLogs)
    .where(and(...conditions))
    .orderBy(asc(exerciseLogs.date))
    .limit(range.date || (range.from && range.to) ? 100000 : 200);
}

async function assertActiveDefinition(userId: string, exerciseKey: string) {
  const [def] = await getDb()
    .select({ exerciseKey: exerciseDefinitions.exerciseKey })
    .from(exerciseDefinitions)
    .where(
      and(
        eq(exerciseDefinitions.userId, userId),
        eq(exerciseDefinitions.exerciseKey, exerciseKey),
        eq(exerciseDefinitions.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(def);
}

/** Upserts the daily bodyweight-rep total. Validates the key against the catalog. */
export async function upsertLog(
  viewer: Viewer,
  input: { date: string; exerciseKey: string; reps: number },
) {
  const owner = requireOwner(viewer);
  if (!(await assertActiveDefinition(owner.userId, input.exerciseKey))) return null;
  const [row] = await getDb()
    .insert(exerciseLogs)
    .values({ userId: owner.userId, ...input })
    .onConflictDoUpdate({
      target: [exerciseLogs.userId, exerciseLogs.date, exerciseLogs.exerciseKey],
      set: { reps: input.reps },
    })
    .returning();
  return row;
}

export async function listSets(viewer: Viewer, range: { date?: string; from?: string; to?: string }) {
  requireScope(viewer, "exercises");
  const db = getDb();
  const conditions = [eq(exerciseSets.userId, viewer.effectiveUserId)];
  if (range.date) conditions.push(eq(exerciseSets.date, range.date));
  else if (range.from && range.to) {
    conditions.push(gte(exerciseSets.date, range.from), lte(exerciseSets.date, range.to));
  }
  return db
    .select()
    .from(exerciseSets)
    .where(and(...conditions))
    .orderBy(asc(exerciseSets.date), asc(exerciseSets.setNumber));
}

export const MAX_SETS_PER_DAY = 20;

/** Adds a set with auto-incremented set_number. Validates against the catalog
 *  (spec doc 11: exercise-sets validates too — consistency fix vs original). */
export async function addSet(
  viewer: Viewer,
  input: { date: string; exerciseKey: string; weightKg: number; reps: number },
): Promise<{ set: typeof exerciseSets.$inferSelect } | { error: "unknown_exercise" | "max_sets" }> {
  const owner = requireOwner(viewer);
  if (!(await assertActiveDefinition(owner.userId, input.exerciseKey))) {
    return { error: "unknown_exercise" };
  }
  const db = getDb();
  const existing = await db
    .select({ setNumber: exerciseSets.setNumber })
    .from(exerciseSets)
    .where(
      and(
        eq(exerciseSets.userId, owner.userId),
        eq(exerciseSets.date, input.date),
        eq(exerciseSets.exerciseKey, input.exerciseKey),
      ),
    )
    .orderBy(desc(exerciseSets.setNumber));
  if (existing.length >= MAX_SETS_PER_DAY) return { error: "max_sets" };
  const setNumber = existing.length > 0 ? existing[0].setNumber + 1 : 1;
  const [set] = await db
    .insert(exerciseSets)
    .values({ userId: owner.userId, setNumber, ...input })
    .returning();
  return { set };
}

/** Deletes the last set of the day for an exercise (original contract). */
export async function deleteLastSet(
  viewer: Viewer,
  input: { date: string; exerciseKey: string },
): Promise<boolean> {
  const owner = requireOwner(viewer);
  const db = getDb();
  const [last] = await db
    .select({ id: exerciseSets.id })
    .from(exerciseSets)
    .where(
      and(
        eq(exerciseSets.userId, owner.userId),
        eq(exerciseSets.date, input.date),
        eq(exerciseSets.exerciseKey, input.exerciseKey),
      ),
    )
    .orderBy(desc(exerciseSets.setNumber))
    .limit(1);
  if (!last) return false;
  await db
    .delete(exerciseSets)
    .where(and(eq(exerciseSets.id, last.id), eq(exerciseSets.userId, owner.userId)));
  return true;
}
