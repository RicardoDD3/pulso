import { unlink } from "node:fs/promises";
import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as labsRepo from "@/lib/db/repos/labs";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const sessionId = z.uuid().parse(id);
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const detail = await labsRepo.getSession(viewer, sessionId);
  if (!detail) return apiError(404, "not_found");
  return ok(detail);
});

/** DELETE — owner only; removes results (cascade) and the stored PDF. */
export const DELETE = withApi<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const sessionId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const deleted = await labsRepo.deleteSession(viewer, sessionId);
  if (!deleted) return apiError(404, "not_found");
  if (deleted.sourceFilePath) {
    try {
      await unlink(deleted.sourceFilePath);
    } catch (err) {
      logger.warn({ sessionId, err: err instanceof Error ? err.name : "unknown" }, "labs_pdf_unlink_failed");
    }
  }
  return ok({ deleted: true });
});
