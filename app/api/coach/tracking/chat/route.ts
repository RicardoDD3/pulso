import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { getFeatures } from "@/lib/system/features";
import { streamChat } from "@/lib/llm";
import { isOverQuota } from "@/lib/llm/usage";
import * as convRepo from "@/lib/db/repos/conversations";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { buildHealthContext } from "@/lib/health/context";
import type { ModelMessage } from "ai";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_BYTES = 32 * 1024;

const bodySchema = z.object({
  planId: z.uuid().nullable().optional(),
  message: z.string().min(1),
});

/**
 * POST /api/coach/tracking/chat — the read-only tracking coach (spec doc 08):
 * one thread per (user, plan), 24h rolling retention, no plan modification.
 */
export const POST = withApi(async (req) => {
  const viewer = await resolveViewer();
  if (!getFeatures().chatEnabled) return apiError(400, "feature_disabled");

  const body = bodySchema.parse(await req.json());
  if (new TextEncoder().encode(body.message).length > MAX_MESSAGE_BYTES) {
    return apiError(413, "payload_too_large");
  }
  if (!(await checkRateLimit(viewer.userId, RATE_LIMITS.chat))) {
    return apiError(429, "rate_limited");
  }

  const conversation = await convRepo.ensureTrackingConversation(viewer, body.planId ?? null);
  const [profile, history] = await Promise.all([
    profilesRepo.getProfile(viewer),
    convRepo.listMessages(viewer, conversation.id),
  ]);
  if (await isOverQuota(viewer.userId, profile.timezone)) {
    return apiError(429, "quota_exceeded");
  }

  const context = await buildHealthContext(viewer, "tracking");
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
            feature: "tracking",
            viewer,
            model: conversation.model ?? undefined,
            system: context.prompt,
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
      } catch {
        send({ type: "error", message: "stream_failed" });
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
