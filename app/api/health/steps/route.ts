import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  viewAs: z.uuid().optional(),
});

/** GET /api/health/steps?from=&to= — steps per day (used by Training). */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const steps = await healthRepo.stepsRange(viewer, query.from, query.to);
  return ok({ steps });
});
