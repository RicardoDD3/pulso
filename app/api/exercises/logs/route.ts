import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as exercisesRepo from "@/lib/db/repos/exercises";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z
  .object({
    date: DATE.optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    viewAs: z.uuid().optional(),
  })
  .refine((q) => !(q.from && !q.to) && !(q.to && !q.from), { message: "from+to go together" });

const postSchema = z.object({
  date: DATE,
  exerciseKey: z.string().min(1).max(60),
  reps: z.number().int().min(0).max(10000),
});

export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const logs = await exercisesRepo.listLogs(viewer, query);
  return ok({ logs });
});

export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = postSchema.parse(await req.json());
  const log = await exercisesRepo.upsertLog(viewer, body);
  if (!log) return apiError(400, "unknown_exercise");
  return ok({ log });
});
