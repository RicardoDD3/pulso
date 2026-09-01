/**
 * FIT enricher writes (spec doc 03, layer 1). One transaction replaces the
 * workout's laps/route/zones and updates its effort columns. Every workouts
 * WHERE includes user_id — never id alone (spec doc 06).
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ParsedFit } from "@/lib/fit/parse";
import type { WorkoutWeather } from "@/lib/weather/open-meteo";

/**
 * Apply a parsed FIT to an owned workout: replace workout_laps (kind 'lap'),
 * workout_route_points and workout_hr_zones (when present), and update the
 * workout's effort columns (only fields the FIT actually carries).
 * Returns false when the workout does not belong to the user.
 */
export async function applyFitToWorkout(
  userId: string,
  workoutId: string,
  parsed: ParsedFit,
): Promise<boolean> {
  const db = getDb();
  const s = parsed.session;
  const workoutSet: Partial<typeof schema.workouts.$inferInsert> = { detailSource: "fit" };
  if (s) {
    if (s.aerobicTe !== null) workoutSet.aerobicTe = s.aerobicTe;
    if (s.anaerobicTe !== null) workoutSet.anaerobicTe = s.anaerobicTe;
    if (s.trainingLoad !== null) workoutSet.trainingLoad = s.trainingLoad;
    if (s.totalTimerS !== null) workoutSet.movingS = Math.round(s.totalTimerS);
    if (s.totalAscentM !== null) workoutSet.elevationGainM = s.totalAscentM;
    if (s.totalDescentM !== null) workoutSet.elevationLossM = s.totalDescentM;
  }

  return db.transaction(async (tx) => {
    const [workout] = await tx
      .update(schema.workouts)
      .set(workoutSet)
      .where(and(eq(schema.workouts.id, workoutId), eq(schema.workouts.userId, userId)))
      .returning({ id: schema.workouts.id });
    if (!workout) return false;

    await tx
      .delete(schema.workoutLaps)
      .where(and(eq(schema.workoutLaps.workoutId, workoutId), eq(schema.workoutLaps.kind, "lap")));
    if (parsed.laps.length > 0) {
      await tx.insert(schema.workoutLaps).values(
        parsed.laps.map((lap) => ({
          workoutId,
          kind: "lap",
          lapIndex: lap.lapIndex,
          intensityType: lap.intensity,
          startAt: lap.startTime,
          durationS: lap.totalTimerS,
          distanceM: lap.totalDistanceM,
          hrAvg: lap.hrAvg,
          hrMax: lap.hrMax,
          speedAvgMps: lap.speedAvgMps,
          cadenceAvg: lap.avgCadenceSpm,
          powerAvgW: lap.avgPowerW,
          strideLengthCm: lap.strideLengthCm,
          verticalOscillationCm: lap.verticalOscillationCm,
          verticalRatio: lap.verticalRatio,
          groundContactTimeMs: lap.groundContactTimeMs,
          elevationGainM: lap.totalAscentM,
          elevationLossM: lap.totalDescentM,
          startLat: lap.startLat,
          startLng: lap.startLng,
          endLat: lap.endLat,
          endLng: lap.endLng,
        })),
      );
    }

    await tx
      .delete(schema.workoutRoutePoints)
      .where(eq(schema.workoutRoutePoints.workoutId, workoutId));
    if (parsed.routePoints.length > 0) {
      await tx.insert(schema.workoutRoutePoints).values(
        parsed.routePoints.map((p) => ({
          workoutId,
          seq: p.seq,
          lat: p.lat,
          lng: p.lng,
          elevationM: p.elevationM,
          recordedAt: p.recordedAt,
        })),
      );
    }

    if (parsed.hrZones.length > 0) {
      await tx
        .delete(schema.workoutHrZones)
        .where(eq(schema.workoutHrZones.workoutId, workoutId));
      await tx
        .insert(schema.workoutHrZones)
        .values(parsed.hrZones.map((z) => ({ workoutId, zone: z.zone, seconds: z.seconds })));
    }

    return true;
  });
}

/** Best-effort weather insert after enrichment; keeps an existing row (first fetch wins). */
export async function insertWorkoutWeather(
  userId: string,
  workoutId: string,
  weather: WorkoutWeather,
): Promise<void> {
  const db = getDb();
  const [workout] = await db
    .select({ id: schema.workouts.id })
    .from(schema.workouts)
    .where(and(eq(schema.workouts.id, workoutId), eq(schema.workouts.userId, userId)))
    .limit(1);
  if (!workout) return;
  await db
    .insert(schema.workoutWeather)
    .values({ workoutId, ...weather })
    .onConflictDoNothing();
}
