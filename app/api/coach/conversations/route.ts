import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as convRepo from "@/lib/db/repos/conversations";

const listSchema = z.object({
  kind: z.enum(["coach", "tracking", "planner"]).default("coach"),
});

const createSchema = z.object({
  kind: z.enum(["coach", "planner"]).default("coach"),
  title: z.string().max(120).optional(),
  model: z.string().max(80).nullable().optional(),
  planId: z.uuid().nullable().optional(),
});

export const GET = withApi(async (req) => {
  const query = listSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer();
  const items = await convRepo.listConversations(viewer, query.kind);
  return ok({ conversations: items });
});

export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = createSchema.parse(await req.json());
  const conversation = await convRepo.createConversation(viewer, body);
  return ok({ conversation });
});
