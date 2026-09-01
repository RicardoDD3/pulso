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
  .refine((q) => Boolean(q.date || (q.from && q.to)), { message: "date or from+to required" });

const postSchema = z.object({
  date: DATE,
  exerciseKey: z.string().min(1).max(60),
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(1).max(200),
});

const deleteSchema = z.object({
  date: DATE,
  exerciseKey: z.string().min(1).max(60),
});

export const GET = withApi(async (req) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const viewer = await resolveViewer(query.viewAs);
  const sets = await exercisesRepo.listSets(viewer, query);
  return ok({ sets });
});

export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = postSchema.parse(await req.json());
  const result = await exercisesRepo.addSet(viewer, body);
  if ("error" in result) {
    return apiError(400, result.error === "max_sets" ? "max_sets" : "unknown_exercise");
  }
  return ok({ set: result.set });
});

export const DELETE = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = deleteSchema.parse(await req.json());
  const deleted = await exercisesRepo.deleteLastSet(viewer, body);
  if (!deleted) return apiError(404, "not_found");
  return ok({ deleted: true });
});
