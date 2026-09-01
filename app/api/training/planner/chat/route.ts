import { z } from "zod";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, apiError } from "@/lib/api/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/authz/rate-limit";
import { getFeatures } from "@/lib/system/features";
import { streamChat, generateJson, QuotaExceededError } from "@/lib/llm";
import { isOverQuota } from "@/lib/llm/usage";
import * as convRepo from "@/lib/db/repos/conversations";
import * as profilesRepo from "@/lib/db/repos/profiles";
import * as trainingRepo from "@/lib/db/repos/training";
import * as exercisesRepo from "@/lib/db/repos/exercises";
import { buildHealthContext } from "@/lib/health/context";
import { todayInTz } from "@/lib/health/tz";
import { buildIntentPrompt, parseIntents } from "@/lib/training/planner-intent";
import { validatePlannerActions } from "@/lib/training/plan-schemas";
import { executePlannerActions, isEditablePlan } from "@/lib/training/plan-service";
import { formatWeekAnchor } from "@/lib/training/plan-week";
import type { ModelMessage } from "ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MESSAGE_BYTES = 32 * 1024; // spec doc 11 M6: checked BEFORE any write

const bodySchema = z.object({
  conversationId: z.uuid(),
  message: z.string().min(1),
  planId: z.uuid().optional(),
});

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/**
 * POST /api/training/planner/chat — the agentic "Planes" editor (spec doc 09).
 * Owner only. Router LLM classifies intent; ONLY actions in the Zod
 * discriminated-union allowlist execute (each through the same repos the
 * routes use); anything unknown/malformed streams back as an answer. Emits
 * `meta {planModified}` before `done` so the client refreshes the plan view;
 * persists the exchange with its action label.
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
  if (!conversation || conversation.kind !== "planner") return apiError(404, "not_found");

  const [profile, history] = await Promise.all([
    profilesRepo.getProfile(viewer),
    convRepo.listMessages(viewer, conversation.id),
  ]);
  if (await isOverQuota(viewer.userId, profile.timezone)) {
    return apiError(429, "quota_exceeded");
  }

  // Auto-title on the first message (original behavior).
  if ((history ?? []).length === 0) {
    const title = body.message.length > 60 ? `${body.message.slice(0, 57)}...` : body.message;
    await convRepo.updateConversation(viewer, conversation.id, { title });
  }

  const [context, plan, definitions] = await Promise.all([
    buildHealthContext(viewer, "planner"),
    body.planId ? trainingRepo.getPlan(viewer, body.planId) : trainingRepo.activePlan(viewer),
    exercisesRepo.listDefinitions(viewer, { includeInactive: true }),
  ]);
  const planId = plan?.id ?? null;
  const today = todayInTz(profile.timezone || "UTC");
  const model = conversation.model ?? undefined;

  const catalogSummary = definitions
    .map(
      (d) =>
        `- ${d.exerciseKey} — ${d.label} (${d.type === "weighted" ? "pesas" : "cuerpo"}${d.isActive ? "" : ", oculto"})`,
    )
    .join("\n");
  const weekAnchor =
    plan && isEditablePlan(plan.planJson) ? formatWeekAnchor(plan.planJson, today) : undefined;

  // Intent classification (non-streaming). Any failure falls back to answer.
  const chatHistory = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
  const intent = buildIntentPrompt(
    body.message,
    context.prompt.slice(0, 1500),
    chatHistory,
    catalogSummary || undefined,
    weekAnchor,
  );
  let routerText = "";
  let routerModel = model;
  try {
    const result = await generateJson({
      feature: "planner",
      viewer,
      model,
      system: intent.systemPrompt,
      messages: [{ role: "user", content: intent.userMessage }],
      schema: z.unknown(),
    });
    routerText = JSON.stringify(result.value);
    routerModel = result.model;
  } catch (err) {
    if (err instanceof QuotaExceededError) return apiError(429, "quota_exceeded");
    routerText = "";
  }

  // Ported router → Zod allowlist re-validation (spec doc 09 hardening):
  // anything unknown or malformed becomes `answer`, never an execution.
  const actions = validatePlannerActions(parseIntents(routerText));
  const hasExecutable = actions.some((a) => a.action !== "answer");

  const encoder = new TextEncoder();

  if (hasExecutable) {
    const result = await executePlannerActions(viewer, actions, { planId, model, today });
    await convRepo.saveExchange(viewer, conversation.id, {
      userContent: body.message,
      assistantContent: result.text,
      model: routerModel ?? "instance-default",
      action: result.actionLabel,
    });
    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        send({ type: "delta", text: result.text });
        if (result.modified) send({ type: "meta", data: { planModified: true, planId } });
        send({ type: "done", model: routerModel ?? "instance-default", text: result.text });
        controller.close();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  // Answer branch: normal streaming chat over the full planner context.
  const messages: ModelMessage[] = [
    ...chatHistory
      .slice(-20)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }) as ModelMessage),
    { role: "user", content: body.message },
  ];
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      try {
        for await (const chunk of streamChat(
          {
            feature: "planner",
            viewer,
            model,
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
              action: "answer",
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
    headers: { ...SSE_HEADERS, "X-Context-Source": context.contextSource },
  });
});
