import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as grantsRepo from "@/lib/db/repos/grants";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({ action: z.enum(["accept", "revoke"]) });

export const POST = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const grantId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const { action } = actionSchema.parse(await req.json());
  const grant =
    action === "accept"
      ? await grantsRepo.acceptGrant(viewer, grantId)
      : await grantsRepo.revokeGrant(viewer, grantId);
  return ok({ grant });
});
