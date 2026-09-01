import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { getFeatures } from "@/lib/system/features";
import { streamChat, QuotaExceededError } from "@/lib/llm";
import { isOverQuota } from "@/lib/llm/usage";
import * as convRepo from "@/lib/db/repos/conversations";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { buildHealthContext } from "@/lib/health/context";
import type { ModelMessage } from "ai";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_BYTES = 32 * 1024; // spec doc 11 M6: checked BEFORE any write

const bodySchema = z.object({
  conversationId: z.uuid(),
  message: z.string().min(1),
});

/**
 * POST /api/coach/chat — SSE stream (spec doc 08).
 * Owner only (chats are NEVER reachable via grant) → rate limit + quota →
 * context (memo || build) → streamChat → saveExchange only on completion.
 */
export const POST = withApi(async (req) => {
  const viewer = await resolveViewer(); // no viewAs: chats are owner-only
  if (!getFeatures().chatEnabled) return apiError(400, "feature_disabled");

  const body = bodySchema.parse(await req.json());
  if (new TextEncoder().encode(body.message).length > MAX_MESSAGE_BYTES) {
    return apiError(413, "payload_too_large");
  }
  if (!(await checkRateLimit(viewer.userId, RATE_LIMITS.chat))) {
    return apiError(429, "rate_limited");
  }

  const conversation = await convRepo.getConversation(viewer, body.conversationId);
  if (!conversation) return apiError(404, "not_found");
  const kind = conversation.kind as "coach" | "tracking" | "planner";

  const [profile, history] = await Promise.all([
    profilesRepo.getProfile(viewer),
    convRepo.listMessages(viewer, conversation.id),
  ]);

  // Quota exceeded → clean 429 BEFORE opening the stream (spec doc 05).
  if (await isOverQuota(viewer.userId, profile.timezone)) {
    return apiError(429, "quota_exceeded");
  }

  const context = await buildHealthContext(viewer, kind, {
    timezone: profile.timezone,
    locale: profile.locale,
    planId: conversation.planId,
  });

  const messages: ModelMessage[] = [
    ...(history ?? []).map(
      (m) => ({ role: m.role as "user" | "assistant", content: m.content }) as ModelMessage,
    ),
    { role: "user", content: body.message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      try {
        for await (const chunk of streamChat(
          {
            feature: kind,
            viewer,
            model: conversation.model ?? undefined,
            system: context.system,
            messages,
            abortSignal: req.signal,
          },
          { timezone: profile.timezone },
        )) {
          send(chunk);
          if (chunk.type === "done") {
            await convRepo.saveExchange(viewer, conversation.id, {
              userContent: body.message,
              assistantContent: chunk.text,
              model: chunk.model,
              tokensIn: chunk.tokensIn,
              tokensOut: chunk.tokensOut,
            });
          }
        }
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          send({ type: "error", message: "quota_exceeded" });
        } else {
          send({ type: "error", message: "stream_failed" });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Context-Source": context.contextSource,
    },
  });
});
