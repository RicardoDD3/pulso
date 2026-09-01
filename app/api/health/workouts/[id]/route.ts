import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/health/workouts/[id] — full detail (laps, zones, route, weather). */
export const GET = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const workoutId = z.uuid().parse(id);
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const detail = await healthRepo.workoutDetail(viewer, workoutId);
  if (!detail) return apiError(404, "not_found");
  return ok(detail);
});
