import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveViewer, requireOwner } from "@/lib/authz/viewer";
import { withApi, ok, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { getFeatures } from "@/lib/system/features";
import { getEnv } from "@/lib/env";
import { getQueue } from "@/lib/queue";
import * as labsRepo from "@/lib/db/repos/labs";
import * as profilesRepo from "@/lib/db/repos/profiles";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 15 * 1024 * 1024;

/** POST /api/labs/upload — multipart PDF → 202 + processing session. */
export const POST = withApi(async (req) => {
  const viewer = requireOwner(await resolveViewer());
  if (!getFeatures().labsExtractionEnabled) return apiError(400, "feature_disabled");
  if (!(await checkRateLimit(viewer.userId, RATE_LIMITS.labsUpload))) {
    return apiError(429, "rate_limited");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "invalid_input");
  if (file.size > MAX_PDF_BYTES) return apiError(413, "payload_too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Magic bytes, not Content-Type (spec doc 07): %PDF-
  const isPdf =
    bytes.length > 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  if (!isPdf) return apiError(400, "invalid_input");

  // Store BEFORE extracting — enables re-extraction later (spec doc 07).
  const dir = path.join(getEnv().UPLOADS_DIR, viewer.userId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${crypto.randomUUID()}.pdf`);
  await writeFile(filePath, bytes);

  const session = await labsRepo.createProcessingSession(viewer, filePath);
  const profile = await profilesRepo.getProfile(viewer);
  await getQueue("labs").add("extract", {
    userId: viewer.userId,
    sessionId: session.id,
    filePath,
    timezone: profile.timezone,
  });

  return ok({ session: { id: session.id, status: "processing" } }, { status: 202 });
});
