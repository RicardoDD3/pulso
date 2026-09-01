/**
 * Single error envelope for all API routes (spec doc 11, M3):
 * `{ error: { code, message } }` with catalog messages — real detail goes to
 * the server log, never to the client.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthzError } from "@/lib/authz/viewer";
import { logger } from "@/lib/logger";

const MESSAGES: Record<string, string> = {
  unauthenticated: "Authentication required.",
  not_found: "Not found.",
  read_only_grant: "Shared access is read-only.",
  invalid_input: "Invalid request.",
  rate_limited: "Too many requests. Try again later.",
  quota_exceeded: "Daily LLM quota exceeded.",
  payload_too_large: "Payload too large.",
  feature_disabled: "This feature is not enabled on this instance.",
  unknown_exercise: "Exercise not found in your catalog.",
  max_sets: "Max 20 sets per exercise per day.",
  catalog_no_delete: "The exercise catalog has no hard delete — hide it instead.",
  internal: "Something went wrong.",
};

export function apiError(status: number, code: keyof typeof MESSAGES | string) {
  return NextResponse.json(
    { error: { code, message: MESSAGES[code] ?? MESSAGES.internal } },
    { status },
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as unknown as Record<string, unknown>, init);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: AuthzError → its status/code, ZodError → 400,
 * anything else → logged + 500 with generic envelope.
 */
export function withApi<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AuthzError) return apiError(err.status, err.message);
      if (err instanceof ZodError) return apiError(400, "invalid_input");
      if (err instanceof RangeError) return apiError(400, "invalid_input");
      logger.error({ err, url: req.url.split("?")[0] }, "api_error");
      return apiError(500, "internal");
    }
  };
}
