import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as labsRepo from "@/lib/db/repos/labs";

export const GET = withApi(async (req) => {
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const sessions = await labsRepo.listSessions(viewer);
  return ok({ sessions });
});
