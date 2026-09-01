import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  viewAs: z.uuid().optional(),
});

/** GET /api/health/workouts?from=&to= — workouts in range (paginated). */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const workouts = await healthRepo.workoutsRange(viewer, query.from, query.to, query);
  return ok({ workouts });
});
