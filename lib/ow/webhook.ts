/**
 * Verification of OW outgoing-webhook signatures.
 *
 * OW delivers webhooks through a self-hosted Svix server
 * (backend/app/services/outgoing_webhooks/svix.py), so payloads carry the
 * standard Svix signature scheme:
 *
 * - headers `svix-id`, `svix-timestamp`, `svix-signature` (Svix also sends the
 *   `webhook-*` aliases; both are accepted here);
 * - the secret is `whsec_` + base64 key (GET /webhooks/endpoints/{id}/secret);
 * - signature = base64(HMAC-SHA256(key, "{id}.{timestamp}.{payload}"));
 * - the signature header holds space-separated `v1,<base64>` entries (multiple
 *   during secret rotation).
 *
 * Comparison is constant-time and timestamps outside the tolerance window
 * (5 minutes, matching Svix's default) are rejected.
 */
import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TOLERANCE_S = 5 * 60;
const SECRET_PREFIX = "whsec_";

function headerLookup(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a webhook delivery against the endpoint secret. `payload` must be the
 * raw request body exactly as received (re-serializing parsed JSON breaks the
 * signature). Returns false — never throws — on any missing or malformed input.
 */
export function verifyWebhookSignature(
  payload: string,
  headers: Record<string, string>,
  secret: string,
  options: { toleranceS?: number; nowMs?: number } = {},
): boolean {
  const id = headerLookup(headers, "svix-id") ?? headerLookup(headers, "webhook-id");
  const timestamp =
    headerLookup(headers, "svix-timestamp") ?? headerLookup(headers, "webhook-timestamp");
  const signatureHeader =
    headerLookup(headers, "svix-signature") ?? headerLookup(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Reject replays: timestamp is unix seconds, ± tolerance.
  const toleranceS = options.toleranceS ?? DEFAULT_TOLERANCE_S;
  const nowS = (options.nowMs ?? Date.now()) / 1000;
  const timestampS = Number(timestamp);
  if (!Number.isFinite(timestampS)) return false;
  if (Math.abs(nowS - timestampS) > toleranceS) return false;

  let key: Buffer;
  try {
    key = Buffer.from(
      secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret,
      "base64",
    );
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`, "utf8")
    .digest("base64");

  // Header may carry several space-separated "v1,<sig>" entries (key rotation).
  for (const entry of signatureHeader.split(" ")) {
    const [version, signature] = entry.split(",", 2);
    if (version !== "v1" || !signature) continue;
    if (constantTimeEqual(signature, expected)) return true;
  }
  return false;
}
