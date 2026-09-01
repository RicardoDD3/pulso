import { z } from "zod";
import { resolveViewer, GRANT_SCOPES } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as grantsRepo from "@/lib/db/repos/grants";

const createSchema = z.object({
  email: z.string().email(),
  scopes: z.array(z.enum(GRANT_SCOPES)).min(1),
});

export const GET = withApi(async () => {
  const viewer = await resolveViewer();
  const grants = await grantsRepo.listGrants(viewer);
  return ok(grants);
});

export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  const body = createSchema.parse(await req.json());
  const grant = await grantsRepo.createGrant(viewer, body.email, body.scopes);
  return ok({ grant });
});
