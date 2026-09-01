import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as convRepo from "@/lib/db/repos/conversations";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().min(1).max(120),
    model: z.string().max(80).nullable(),
  })
  .partial();

export const GET = withApi<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const conversationId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const [conversation, messages] = await Promise.all([
    convRepo.getConversation(viewer, conversationId),
    convRepo.listMessages(viewer, conversationId),
  ]);
  if (!conversation || !messages) return apiError(404, "not_found");
  return ok({ conversation, messages });
});

export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const conversationId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const patch = patchSchema.parse(await req.json());
  const conversation = await convRepo.updateConversation(viewer, conversationId, patch);
  if (!conversation) return apiError(404, "not_found");
  return ok({ conversation });
});

export const DELETE = withApi<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const conversationId = z.uuid().parse(id);
  const viewer = await resolveViewer();
  const deleted = await convRepo.deleteConversation(viewer, conversationId);
  if (!deleted) return apiError(404, "not_found");
  return ok({ deleted: true });
});
