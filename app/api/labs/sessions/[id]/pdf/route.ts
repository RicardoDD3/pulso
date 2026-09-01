import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, apiError } from "@/lib/api/respond";
import * as labsRepo from "@/lib/db/repos/labs";

type Ctx = { params: Promise<{ id: string }> };

/** GET — download the original PDF (owner only, never via grant). */
export const GET = withApi<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const sessionId = z.uuid().parse(id);
  const viewer = requireOwner(await resolveViewer());
  const detail = await labsRepo.getSession(viewer, sessionId);
  if (!detail?.session.sourceFilePath) return apiError(404, "not_found");
  try {
    const bytes = await readFile(detail.session.sourceFilePath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lab-${detail.session.sampleDate ?? sessionId}.pdf"`,
      },
    });
  } catch {
    return apiError(404, "not_found");
  }
});
