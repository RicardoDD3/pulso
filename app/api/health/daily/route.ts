import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { mergeHealthDay } from "@/lib/health/merge";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  viewAs: z.uuid().optional(),
});

/** GET /api/health/daily?date= — merged day + that night's sleep + provider scores. */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const [rows, sleep, scores, profile] = await Promise.all([
    healthRepo.healthDaysForDate(viewer, query.date),
    healthRepo.sleepForDate(viewer, query.date),
    healthRepo.providerScoresForDate(viewer, query.date),
    profilesRepo.getProfile(viewer),
  ]);
  return ok({
    day: mergeHealthDay(rows, profile.primaryProvider),
    sleep,
    scores,
  });
});
