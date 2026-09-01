/**
 * Health data repo (spec docs 02/06). Read-only for features; ingestion
 * writes through lib/db/repos/ingest.ts. All reads scoped by Viewer;
 * temporal queries are range-capped (≤366 days — spec doc 11).
 */
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireScope, type Viewer } from "@/lib/authz/viewer";

export const MAX_RANGE_DAYS = 366;

function assertRange(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days > MAX_RANGE_DAYS) {
    throw new RangeError("range_too_large");
  }
}

export async function healthDaysForDate(viewer: Viewer, date: string) {
  requireScope(viewer, "health");
  return getDb()
    .select()
    .from(schema.healthDays)
    .where(and(eq(schema.healthDays.userId, viewer.effectiveUserId), eq(schema.healthDays.date, date)));
}

export async function healthDaysRange(viewer: Viewer, from: string, to: string) {
  requireScope(viewer, "health");
  assertRange(from, to);
  return getDb()
    .select()
    .from(schema.healthDays)
    .where(
      and(
        eq(schema.healthDays.userId, viewer.effectiveUserId),
        gte(schema.healthDays.date, from),
        lte(schema.healthDays.date, to),
      ),
    )
    .orderBy(asc(schema.healthDays.date));
}

/** Sleep sessions ending on the given calendar date window (that night's sleep). */
export async function sleepForDate(viewer: Viewer, date: string) {
  requireScope(viewer, "health");
  const dayStart = new Date(`${date}T00:00:00Z`);
  const windowStart = new Date(dayStart.getTime() - 12 * 3600_000);
  const windowEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  return getDb()
    .select()
    .from(schema.sleepSessions)
    .where(
      and(
        eq(schema.sleepSessions.userId, viewer.effectiveUserId),
        gte(schema.sleepSessions.endAt, windowStart),
        lte(schema.sleepSessions.endAt, windowEnd),
      ),
    )
    .orderBy(asc(schema.sleepSessions.endAt));
}

export async function providerScoresForDate(viewer: Viewer, date: string) {
  requireScope(viewer, "health");
  return getDb()
    .select()
    .from(schema.providerScores)
    .where(
      and(
        eq(schema.providerScores.userId, viewer.effectiveUserId),
        eq(schema.providerScores.date, date),
      ),
    );
}

export const SAMPLE_METRICS = ["hr", "stress", "body_battery", "spo2", "respiration"] as const;
export type SampleMetric = (typeof SAMPLE_METRICS)[number];

/** Intraday samples are queried one day at a time (ported policy — bounds memory). */
export async function samplesForDay(viewer: Viewer, date: string, metric: SampleMetric) {
  requireScope(viewer, "health");
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + 36 * 3600_000); // covers any tz offset of the day
  return getDb()
    .select({
      recordedAt: schema.metricSamples.recordedAt,
      value: schema.metricSamples.value,
      provider: schema.metricSamples.provider,
    })
    .from(schema.metricSamples)
    .where(
      and(
        eq(schema.metricSamples.userId, viewer.effectiveUserId),
        eq(schema.metricSamples.metric, metric),
        gte(schema.metricSamples.recordedAt, start),
        lte(schema.metricSamples.recordedAt, end),
      ),
    )
    .orderBy(asc(schema.metricSamples.recordedAt));
}

export async function workoutsRange(
  viewer: Viewer,
  from: string,
  to: string,
  opts: { limit?: number; offset?: number } = {},
) {
  requireScope(viewer, "workouts");
  assertRange(from, to);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T23:59:59Z`);
  return getDb()
    .select()
    .from(schema.workouts)
    .where(
      and(
        eq(schema.workouts.userId, viewer.effectiveUserId),
        gte(schema.workouts.startAt, start),
        lte(schema.workouts.startAt, end),
      ),
    )
    .orderBy(desc(schema.workouts.startAt))
    .limit(Math.min(opts.limit ?? 200, 500))
    .offset(opts.offset ?? 0);
}

/** Full workout detail — laps, zones, route, weather. Ownership enforced by
 *  (id AND user_id) in the WHERE, never id alone (spec doc 06). */
export async function workoutDetail(viewer: Viewer, workoutId: string) {
  requireScope(viewer, "workouts");
  const db = getDb();
  const [workout] = await db
    .select()
    .from(schema.workouts)
    .where(
      and(eq(schema.workouts.id, workoutId), eq(schema.workouts.userId, viewer.effectiveUserId)),
    )
    .limit(1);
  if (!workout) return null;
  const [laps, zones, route, weather] = await Promise.all([
    db
      .select()
      .from(schema.workoutLaps)
      .where(eq(schema.workoutLaps.workoutId, workout.id))
      .orderBy(asc(schema.workoutLaps.kind), asc(schema.workoutLaps.lapIndex)),
    db
      .select()
      .from(schema.workoutHrZones)
      .where(eq(schema.workoutHrZones.workoutId, workout.id))
      .orderBy(asc(schema.workoutHrZones.zone)),
    db
      .select()
      .from(schema.workoutRoutePoints)
      .where(eq(schema.workoutRoutePoints.workoutId, workout.id))
      .orderBy(asc(schema.workoutRoutePoints.seq)),
    db
      .select()
      .from(schema.workoutWeather)
      .where(eq(schema.workoutWeather.workoutId, workout.id))
      .limit(1),
  ]);
  return { workout, laps, zones, route, weather: weather[0] ?? null };
}

export async function latestBodyMeasurement(viewer: Viewer, onOrBefore: string) {
  requireScope(viewer, "health");
  const cutoff = new Date(`${onOrBefore}T23:59:59Z`);
  const rows = await getDb()
    .select()
    .from(schema.bodyMeasurements)
    .where(
      and(
        eq(schema.bodyMeasurements.userId, viewer.effectiveUserId),
        lte(schema.bodyMeasurements.measuredAt, cutoff),
      ),
    )
    .orderBy(desc(schema.bodyMeasurements.measuredAt))
    .limit(2);
  return { latest: rows[0] ?? null, previous: rows[1] ?? null };
}

export async function stepsRange(viewer: Viewer, from: string, to: string) {
  requireScope(viewer, "health");
  assertRange(from, to);
  const rows = await healthDaysRange(viewer, from, to);
  // One entry per date: max steps across providers (steps double-report is
  // provider duplication, not additive).
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (r.steps != null) byDate.set(r.date, Math.max(byDate.get(r.date) ?? 0, r.steps));
  }
  return [...byDate.entries()].map(([date, steps]) => ({ date, steps }));
}

export async function connectionsList(viewer: Viewer) {
  requireScope(viewer, "health");
  return getDb()
    .select()
    .from(schema.wearableConnections)
    .where(eq(schema.wearableConnections.userId, viewer.effectiveUserId))
    .orderBy(asc(schema.wearableConnections.provider));
}

export async function recentSyncRuns(viewer: Viewer, limit = 20) {
  requireScope(viewer, "health");
  return getDb()
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.userId, viewer.effectiveUserId))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(Math.min(limit, 100));
}

/** Multi-day provider scores for trends. */
export async function providerScoresRange(viewer: Viewer, from: string, to: string) {
  requireScope(viewer, "health");
  assertRange(from, to);
  return getDb()
    .select()
    .from(schema.providerScores)
    .where(
      and(
        eq(schema.providerScores.userId, viewer.effectiveUserId),
        gte(schema.providerScores.date, from),
        lte(schema.providerScores.date, to),
      ),
    )
    .orderBy(asc(schema.providerScores.date));
}

export async function sleepRange(viewer: Viewer, fromDate: string, toDate: string) {
  requireScope(viewer, "health");
  assertRange(fromDate, toDate);
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T23:59:59Z`);
  return getDb()
    .select()
    .from(schema.sleepSessions)
    .where(
      and(
        eq(schema.sleepSessions.userId, viewer.effectiveUserId),
        gte(schema.sleepSessions.endAt, start),
        lte(schema.sleepSessions.endAt, end),
      ),
    )
    .orderBy(asc(schema.sleepSessions.endAt));
}

export async function bodyMeasurementsRange(viewer: Viewer, from: string, to: string) {
  requireScope(viewer, "health");
  assertRange(from, to);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T23:59:59Z`);
  return getDb()
    .select()
    .from(schema.bodyMeasurements)
    .where(
      and(
        eq(schema.bodyMeasurements.userId, viewer.effectiveUserId),
        gte(schema.bodyMeasurements.measuredAt, start),
        lte(schema.bodyMeasurements.measuredAt, end),
      ),
    )
    .orderBy(asc(schema.bodyMeasurements.measuredAt));
}

/** Bulk fetch used by the FIT enricher to find match candidates. */
export async function workoutsNear(viewer: Viewer, at: Date, toleranceMinutes: number) {
  requireScope(viewer, "workouts");
  const start = new Date(at.getTime() - toleranceMinutes * 60_000);
  const end = new Date(at.getTime() + toleranceMinutes * 60_000);
  return getDb()
    .select()
    .from(schema.workouts)
    .where(
      and(
        eq(schema.workouts.userId, viewer.effectiveUserId),
        gte(schema.workouts.startAt, start),
        lte(schema.workouts.startAt, end),
      ),
    );
}
