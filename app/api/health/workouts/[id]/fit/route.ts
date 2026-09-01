import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { parseFitFile, FitTooLargeError, MAX_FIT_BYTES, type ParsedFit } from "@/lib/fit/parse";
import { matchWorkout } from "@/lib/fit/match";
import { fetchWorkoutWeather } from "@/lib/weather/open-meteo";
import { logger } from "@/lib/logger";
import * as healthRepo from "@/lib/db/repos/health";
import * as fitRepo from "@/lib/db/repos/fit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/health/workouts/[id]/fit — multipart .fit → enricher (spec docs 03/06). */
export const POST = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const workoutId = z.uuid().parse(id);
  const viewer = requireOwner(await resolveViewer());
  if (!(await checkRateLimit(viewer.userId, RATE_LIMITS.fitUpload))) {
    return apiError(429, "rate_limited");
  }

  const detail = await healthRepo.workoutDetail(viewer, workoutId);
  if (!detail) return apiError(404, "not_found");

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "invalid_input");
  // v1 accepts .fit only (TCX/GPX later — spec doc 06).
  if (!file.name.toLowerCase().endsWith(".fit")) return apiError(400, "invalid_input");
  if (file.size > MAX_FIT_BYTES) return apiError(413, "payload_too_large");

  let parsed: ParsedFit;
  try {
    parsed = parseFitFile(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof FitTooLargeError) return apiError(413, "payload_too_large");
    return apiError(400, "invalid_input");
  }

  // The uploaded FIT must match THIS workout (±5 min + 10% distance rule).
  if (matchWorkout(parsed, [detail.workout]) === null) {
    return apiError(409, "fit_mismatch");
  }

  const applied = await fitRepo.applyFitToWorkout(viewer.userId, workoutId, parsed);
  if (!applied) return apiError(404, "not_found");

  // Best-effort weather (spec doc 03): needs a start coordinate and no row yet.
  if (!detail.weather) {
    const startLat = parsed.session?.startLat ?? parsed.routePoints[0]?.lat;
    const startLng = parsed.session?.startLng ?? parsed.routePoints[0]?.lng;
    if (startLat != null && startLng != null) {
      try {
        const weather = await fetchWorkoutWeather(
          startLat,
          startLng,
          parsed.session?.startTime ?? detail.workout.startAt,
        );
        if (weather) await fitRepo.insertWorkoutWeather(viewer.userId, workoutId, weather);
      } catch (err) {
        logger.warn({ err, workoutId }, "fit_weather_fetch_failed");
      }
    }
  }

  return ok({
    applied: true,
    laps: parsed.laps.length,
    routePoints: parsed.routePoints.length,
    hrZones: parsed.hrZones.length,
  });
});
