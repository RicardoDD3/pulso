import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi } from "@/lib/api/respond";
import { exportUserData } from "@/lib/account/export";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — full data export as ZIP (owner only; audited). */
export const GET = withApi(async () => {
  const viewer = requireOwner(await resolveViewer());
  const zip = await exportUserData(viewer);
  await getDb().insert(schema.auditLog).values({
    actorId: viewer.userId,
    ownerId: viewer.userId,
    action: "data_export",
    resource: "user",
  });
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="pulso-export-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
});
