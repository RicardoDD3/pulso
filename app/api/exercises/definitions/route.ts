import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import * as exercisesRepo from "@/lib/db/repos/exercises";

const createSchema = z.object({
  label: z.string().min(1).max(60),
  emoji: z.string().min(1).max(8),
  color: z.string().min(1).max(20),
  type: z.enum(["bodyweight", "weighted"]),
  increment: z.number().int().min(1).max(100),
});

export const GET = withApi(async (req) => {
  const viewAs = new URL(req.url).searchParams.get("viewAs");
  const viewer = await resolveViewer(viewAs);
  const [definitions, lastWeights] = await Promise.all([
    exercisesRepo.listDefinitions(viewer),
    exercisesRepo.lastWeights(viewer),
  ]);
  return ok({ definitions, lastWeights });
});

export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = createSchema.parse(await req.json());
  const definition = await exercisesRepo.createDefinition(viewer, body);
  if (!definition) return apiError(400, "invalid_input");
  return ok({ definition });
});
