import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import { getFeatures } from "@/lib/system/features";

/** GET — the instance's feature flags (auth required; no secrets exposed). */
export const GET = withApi(async () => {
  await resolveViewer();
  return ok(getFeatures());
});
