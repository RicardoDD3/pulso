import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { mergeHealthDay } from "@/lib/health/merge";
import {
  buildGapSeries,
  buildTrainingEffectSeries,
  buildTrainingLoadSeries,
  type TrendActivity,
} from "@/lib/health/effort-trends";
import type { WorkoutRow } from "@/lib/db/schema";

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(366).default(90),
  viewAs: z.uuid().optional(),
});

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Canonical workout row → the ported effort-trends input shape. */
function toTrendActivity(w: WorkoutRow): TrendActivity {
  return {
    activity_id: w.id,
    date: isoDay(w.startAt),
    distance_meters: w.distanceM,
    duration_seconds: w.durationS,
    avg_hr: w.hrAvg,
    aerobic_te: w.aerobicTe,
    anaerobic_te: w.anaerobicTe,
    training_load: w.trainingLoad,
    gap_mps: w.gapMps,
  } as unknown as TrendActivity;
}

/** GET /api/health/trends?days= — aggregated series for 7/30/90-day views. */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const to = new Date();
  const from = new Date(to.getTime() - query.days * 86_400_000);
  const fromIso = isoDay(from);
  const toIso = isoDay(to);

  const [profile, dayRows, sleep, body, workouts] = await Promise.all([
    profilesRepo.getProfile(viewer),
    healthRepo.healthDaysRange(viewer, fromIso, toIso),
    healthRepo.sleepRange(viewer, fromIso, toIso),
    healthRepo.bodyMeasurementsRange(viewer, fromIso, toIso),
    healthRepo.workoutsRange(viewer, fromIso, toIso, { limit: 500 }),
  ]);

  // Merge multi-provider rows per date.
  const byDate = new Map<string, typeof dayRows>();
  for (const row of dayRows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const daily = [...byDate.entries()]
    .map(([date, rows]) => ({ date, ...mergeHealthDay(rows, profile.primaryProvider) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const trendActivities = workouts.map(toTrendActivity);

  return ok({
    from: fromIso,
    to: toIso,
    daily,
    sleep: sleep.map((s) => ({
      date: isoDay(s.endAt),
      totalMin: s.totalMin,
      score: s.score,
      isNap: s.isNap,
    })),
    body: body.map((b) => ({
      date: isoDay(b.measuredAt),
      weightKg: b.weightKg,
      bodyFatPct: b.bodyFatPct,
      muscleMassKg: b.muscleMassKg,
    })),
    effort: {
      trainingEffect: buildTrainingEffectSeries(trendActivities),
      trainingLoad: buildTrainingLoadSeries(trendActivities),
      gap: buildGapSeries(trendActivities),
    },
  });
});
