import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as trainingRepo from "@/lib/db/repos/training";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/training/plans/[id]/versions — undo snapshots, newest first. */
export const GET = withApi<Ctx>(async (req, ctx) => {
  const planId = z.uuid().parse((await ctx.params).id);
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const versions = await trainingRepo.listVersions(viewer, planId);
  return ok({ versions });
});
