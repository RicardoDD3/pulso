import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { getFeatures } from "@/lib/system/features";
import { getQueue } from "@/lib/queue";
import * as labsRepo from "@/lib/db/repos/labs";
import * as profilesRepo from "@/lib/db/repos/profiles";

type Ctx = { params: Promise<{ id: string }> };

/** POST — re-extraction from the stored PDF (spec doc 07). */
export const POST = withApi<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const sessionId = z.uuid().parse(id);
  const viewer = requireOwner(await resolveViewer());
  if (!getFeatures().labsExtractionEnabled) return apiError(400, "feature_disabled");
  const detail = await labsRepo.getSession(viewer, sessionId);
  if (!detail?.session.sourceFilePath) return apiError(404, "not_found");
  const profile = await profilesRepo.getProfile(viewer);
  await labsRepo.markSessionProcessing(viewer.userId, sessionId);
  await getQueue("labs").add("extract", {
    userId: viewer.userId,
    sessionId,
    filePath: detail.session.sourceFilePath,
    timezone: profile.timezone,
  });
  return ok({ session: { id: sessionId, status: "processing" } }, { status: 202 });
});
