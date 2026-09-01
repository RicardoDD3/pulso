import { createHmac, randomBytes } from "crypto";

import { verifyWebhookSignature } from "@/lib/ow/webhook";

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;
const PAYLOAD = JSON.stringify({ type: "workout.created", data: { id: "abc" } });

function sign(payload: string, id: string, timestamp: string, key: Buffer = KEY): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`, "utf8").digest("base64");
}

function freshHeaders(payload: string = PAYLOAD): Record<string, string> {
  const id = "msg_2mXhP7Qa";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sign(payload, id, timestamp)}`,
  };
}

describe("verifyWebhookSignature (Svix scheme)", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(PAYLOAD, freshHeaders(), SECRET)).toBe(true);
  });

  it("accepts the webhook-* header aliases", () => {
    const h = freshHeaders();
    const aliased = {
      "webhook-id": h["svix-id"],
      "webhook-timestamp": h["svix-timestamp"],
      "webhook-signature": h["svix-signature"],
    };
    expect(verifyWebhookSignature(PAYLOAD, aliased, SECRET)).toBe(true);
  });

  it("accepts case-insensitive header names", () => {
    const h = freshHeaders();
    const upper = {
      "Svix-Id": h["svix-id"],
      "Svix-Timestamp": h["svix-timestamp"],
      "Svix-Signature": h["svix-signature"],
    };
    expect(verifyWebhookSignature(PAYLOAD, upper, SECRET)).toBe(true);
  });

  it("accepts a rotated-secret header carrying several signatures", () => {
    const h = freshHeaders();
    h["svix-signature"] = `v1,${Buffer.from("garbagegarbage").toString("base64")} ${h["svix-signature"]}`;
    expect(verifyWebhookSignature(PAYLOAD, h, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const h = freshHeaders();
    const tampered = PAYLOAD.replace("workout.created", "sleep.created");
    expect(verifyWebhookSignature(tampered, h, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const otherSecret = `whsec_${randomBytes(24).toString("base64")}`;
    expect(verifyWebhookSignature(PAYLOAD, freshHeaders(), otherSecret)).toBe(false);
  });

  it("rejects a stale timestamp (replay outside the 5-minute window)", () => {
    const id = "msg_2mXhP7Qa";
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const headers = {
      "svix-id": id,
      "svix-timestamp": stale,
      "svix-signature": `v1,${sign(PAYLOAD, id, stale)}`,
    };
    expect(verifyWebhookSignature(PAYLOAD, headers, SECRET)).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const id = "msg_2mXhP7Qa";
    const future = String(Math.floor(Date.now() / 1000) + 6 * 60);
    const headers = {
      "svix-id": id,
      "svix-timestamp": future,
      "svix-signature": `v1,${sign(PAYLOAD, id, future)}`,
    };
    expect(verifyWebhookSignature(PAYLOAD, headers, SECRET)).toBe(false);
  });

  it("honors a custom tolerance and injected clock", () => {
    const id = "msg_2mXhP7Qa";
    const timestamp = "1756449000";
    const headers = {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${sign(PAYLOAD, id, timestamp)}`,
    };
    const nowMs = 1756449000 * 1000 + 60_000;
    expect(verifyWebhookSignature(PAYLOAD, headers, SECRET, { nowMs })).toBe(true);
    expect(verifyWebhookSignature(PAYLOAD, headers, SECRET, { nowMs, toleranceS: 30 })).toBe(false);
  });

  it("rejects missing headers, unknown versions, and malformed input", () => {
    const h = freshHeaders();
    expect(verifyWebhookSignature(PAYLOAD, {}, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, { ...h, "svix-signature": "" }, SECRET)).toBe(false);
    expect(
      verifyWebhookSignature(PAYLOAD, { ...h, "svix-signature": h["svix-signature"].replace("v1,", "v2,") }, SECRET),
    ).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, { ...h, "svix-timestamp": "not-a-number" }, SECRET)).toBe(false);
    expect(verifyWebhookSignature(PAYLOAD, h, "")).toBe(false);
  });
});
