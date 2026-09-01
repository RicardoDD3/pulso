import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as convRepo from "@/lib/db/repos/conversations";

const querySchema = z.object({ planId: z.uuid().optional() });

/** GET — the (lazy) tracking thread for a plan + its messages (24h window). */
export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer();
  const conversation = await convRepo.ensureTrackingConversation(viewer, query.planId ?? null);
  const messages = await convRepo.listMessages(viewer, conversation.id);
  return ok({ conversation, messages: messages ?? [] });
});
