import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as healthRepo from "@/lib/db/repos/health";
import * as ingest from "@/lib/db/repos/ingest";
import { getOwClient } from "@/lib/ow/client";
import { getFeatures } from "@/lib/system/features";

/** GET — cached connections + recent sync runs (pipeline health, doc 03). */
export const GET = withApi(async (req) => {
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const [connections, syncRuns] = await Promise.all([
    healthRepo.connectionsList(viewer),
    healthRepo.recentSyncRuns(viewer),
  ]);
  return ok({ connections, syncRuns, wearablesEnabled: getFeatures().wearablesEnabled });
});

const deleteSchema = z.object({
  provider: z.string().min(1).max(40),
  /** also purge that provider's data (OW side + local canonical rows) */
  deleteData: z.boolean().default(false),
});

/** DELETE — disconnect a provider; optionally purge its data everywhere. */
export const DELETE = withApi(async (req) => {
  const viewer = requireOwner(await resolveViewer());
  const body = deleteSchema.parse(await req.json());
  const account = await ingest.getWearableAccount(viewer.userId);
  if (!account) return apiError(404, "not_found");
  const ow = getOwClient();
  if (body.deleteData) {
    await ow.deleteProviderData(account.owUserId, body.provider);
    await ingest.deleteProviderRows(viewer.userId, body.provider);
  } else {
    await ow.disconnect(account.owUserId, body.provider);
  }
  return ok({ disconnected: body.provider, dataDeleted: body.deleteData });
});
