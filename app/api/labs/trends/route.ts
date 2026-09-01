import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as labsRepo from "@/lib/db/repos/labs";

const querySchema = z.object({
  test: z.string().min(1).max(80),
  viewAs: z.uuid().optional(),
});

/** GET /api/labs/trends?test= — series for one normalized analyte. */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const points = await labsRepo.analyteTrend(viewer, query.test);
  return ok({ test: query.test, points });
});
