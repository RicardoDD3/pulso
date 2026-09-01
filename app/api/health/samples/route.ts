import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";
import { SAMPLE_METRICS } from "@/lib/db/repos/health";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metric: z.enum(SAMPLE_METRICS),
  viewAs: z.uuid().optional(),
});

/** GET /api/health/samples?date=&metric= — one day of intraday samples. */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const samples = await healthRepo.samplesForDay(viewer, query.date, query.metric);
  return ok({ samples });
});
