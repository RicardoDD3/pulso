import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { getFeatures } from "@/lib/system/features";
import { getEnv } from "@/lib/env";
import { getOwClient } from "@/lib/ow/client";
import * as ingest from "@/lib/db/repos/ingest";

const bodySchema = z.object({
  provider: z.string().min(1).max(40),
});

/**
 * POST /api/wearables/connect — ensure the OW user exists (lazy, one per
 * Pulso user) and return the provider's OAuth authorization URL.
 * Redirect goes back to APP_URL (never derived from the Host header).
 */
export const POST = withApi(async (req) => {
  const viewer = requireOwner(await resolveViewer());
  if (!getFeatures().wearablesEnabled) return apiError(400, "feature_disabled");
  const { provider } = bodySchema.parse(await req.json());

  const ow = getOwClient();
  let account = await ingest.getWearableAccount(viewer.userId);
  if (!account) {
    const owUser = await ow.ensureUser(viewer.userId);
    account = await ingest.createWearableAccount(viewer.userId, owUser.id);
  }
  if (!account) return apiError(500, "internal");

  const redirectUri = `${getEnv().APP_URL}/settings/wearables`;
  const auth = await ow.getAuthorizationUrl(account.owUserId, provider, redirectUri);
  return ok({ url: auth.authorization_url });
});
