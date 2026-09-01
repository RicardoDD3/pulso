import { z } from "zod";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { deleteAccount } from "@/lib/account/delete";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const bodySchema = z.object({
  /** strong confirmation: the user must type their own email */
  confirmEmail: z.string().email(),
});

export const POST = withApi(async (req) => {
  const viewer = requireOwner(await resolveViewer());
  const { confirmEmail } = bodySchema.parse(await req.json());
  const [user] = await getDb()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, viewer.userId))
    .limit(1);
  if (!user || user.email.toLowerCase() !== confirmEmail.toLowerCase()) {
    return apiError(400, "invalid_input");
  }
  await deleteAccount(viewer);
  return ok({ deleted: true });
});
