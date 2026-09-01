import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/ow/webhook";
import { getQueue } from "@/lib/queue";
import * as ingest from "@/lib/db/repos/ingest";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const envelopeSchema = z.object({
  // OW webhook envelope: event type + the OW user it concerns.
  type: z.string().min(1).max(100),
  data: z
    .object({
      user_id: z.uuid().optional(),
      external_user_id: z.string().optional(),
    })
    .passthrough()
    .optional(),
  user_id: z.uuid().optional(),
});

/**
 * POST /api/wearables/webhook (spec doc 03): verify signature, answer 200
 * FAST, enqueue a job. The payload is never processed inline nor trusted as
 * a data source — the job re-pulls the affected window from the OW API.
 */
export async function POST(req: Request) {
  const secret = getEnv().OW_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "feature_disabled" } }, { status: 400 });

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  if (!verifyWebhookSignature(payload, headers, secret)) {
    return NextResponse.json({ error: { code: "invalid_signature" } }, { status: 401 });
  }

  let parsed: z.infer<typeof envelopeSchema>;
  try {
    parsed = envelopeSchema.parse(JSON.parse(payload));
  } catch {
    return NextResponse.json({ error: { code: "invalid_input" } }, { status: 400 });
  }

  const owUserId = parsed.data?.user_id ?? parsed.user_id;
  const externalUserId = parsed.data?.external_user_id;

  // Resolve the Pulso user: external_user_id IS our user id; else map via table.
  let userId = externalUserId ?? null;
  if (!userId && owUserId) {
    const account = await ingest.getWearableAccountByOwUserId(owUserId);
    userId = account?.userId ?? null;
  }
  if (!userId || !owUserId) {
    // Unknown target: acknowledge (200) so OW doesn't retry forever, log id-only.
    logger.warn({ eventType: parsed.type }, "webhook_unmatched_user");
    return NextResponse.json({ received: true });
  }

  await getQueue("ingest").add(
    "webhook",
    {
      userId,
      owUserId,
      kind: "webhook",
      eventType: parsed.type,
      windowStart: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      windowEnd: new Date().toISOString(),
    },
    // Debounce storms: one webhook job per user per minute window.
    { jobId: `webhook:${userId}:${Math.floor(Date.now() / 60_000)}` },
  );
  return NextResponse.json({ received: true });
}
