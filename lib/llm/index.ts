/**
 * The ONE LLM abstraction features are allowed to know (spec doc 05).
 * streamChat() for SSE chat; generateJson() for schema-validated output.
 *
 * Replaces the original's 7 per-provider routes. No internal HTTP: features
 * call these as functions (kills the Host-header/session-forwarding class of
 * bugs — spec doc 11 A3).
 */
import { generateText, streamText, type ModelMessage } from "ai";
import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { getEnv, envFlags } from "@/lib/env";
import { resolveModel } from "./providers";
import { LlmConfigError } from "./types";
import { extractJson } from "./json";
import { mockChatText, mockJsonValue, mockUsage, MOCK_MODEL_ID } from "./mock";
import { recordUsage, isOverQuota } from "./usage";
import type { Attachment, ChatChunk, ChatRequest, JsonRequest, LlmFeature } from "./types";
import { QuotaExceededError } from "./types";

export { QuotaExceededError } from "./types";
export { extractJson } from "./json";
export type { ChatChunk, ChatRequest, JsonRequest, LlmFeature } from "./types";

const LLM_TIMEOUT_MS = 120_000;
/** Only mark the system block cacheable past this size — below it, Anthropic's
 *  1.25× cache-write premium loses money (threshold ported from the original). */
const ANTHROPIC_CACHE_MIN_CHARS = 16_000;

export function defaultModelFor(feature: LlmFeature): string {
  const env = getEnv();
  if (envFlags.llmMock()) return MOCK_MODEL_ID;
  switch (feature) {
    case "labs_extraction":
      if (!env.VISION_MODEL) throw new LlmConfigError("VISION_MODEL is not configured");
      return env.VISION_MODEL;
    case "plan_generation":
    case "planner":
      return env.PLAN_MODEL ?? env.DEFAULT_CHAT_MODEL;
    default:
      return env.DEFAULT_CHAT_MODEL;
  }
}

function providerOptionsFor(
  modelId: string,
  req: { system: string; feature: LlmFeature; viewer: { effectiveUserId: string } },
): SharedV4ProviderOptions | undefined {
  const provider = modelId.split("/")[0];
  if (provider === "anthropic" && req.system.length >= ANTHROPIC_CACHE_MIN_CHARS) {
    return {
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    };
  }
  if (provider === "openai") {
    // Better cache routing: stable key per user+feature.
    return { openai: { promptCacheKey: `${req.viewer.effectiveUserId}:${req.feature}` } };
  }
  return undefined;
}

function withAttachments(messages: ModelMessage[], attachments?: Attachment[]): ModelMessage[] {
  if (!attachments?.length) return messages;
  // Attach files to the last user message (labs flow: single user turn + PDF).
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const msg = out[i];
    if (msg.role === "user") {
      const textParts =
        typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content;
      out[i] = {
        role: "user",
        content: [
          ...(Array.isArray(textParts) ? textParts : []),
          ...attachments.map((a) => ({
            type: "file" as const,
            data: a.data,
            mediaType: a.mediaType,
            filename: a.filename,
          })),
        ],
      } as ModelMessage;
      return out;
    }
  }
  return out;
}

async function checkQuota(req: ChatRequest, timezone: string) {
  if (await isOverQuota(req.viewer.effectiveUserId, timezone)) throw new QuotaExceededError();
}

type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
} | undefined;

function readUsage(usage: UsageLike) {
  return {
    tokensIn: usage?.inputTokens ?? 0,
    tokensOut: usage?.outputTokens ?? 0,
    tokensCached: usage?.cachedInputTokens ?? 0,
  };
}

/**
 * Streaming chat. Yields delta/reasoning chunks and a final `done` chunk with
 * usage; the caller persists the exchange ONLY after `done` (saveExchange
 * pattern). Provider errors yield an `error` chunk and nothing is persisted.
 */
export async function* streamChat(
  req: ChatRequest,
  opts: { timezone?: string } = {},
): AsyncGenerator<ChatChunk> {
  const modelId = req.model ?? defaultModelFor(req.feature);
  await checkQuota(req, opts.timezone ?? "UTC");

  if (envFlags.llmMock() || modelId.startsWith("mock/")) {
    const text = mockChatText(req.feature);
    yield { type: "delta", text };
    const u = mockUsage();
    await recordUsage({
      userId: req.viewer.effectiveUserId,
      feature: req.feature,
      model: MOCK_MODEL_ID,
      tokensIn: u.inputTokens,
      tokensOut: u.outputTokens,
      tokensCached: u.cachedInputTokens,
    });
    yield {
      type: "done",
      model: MOCK_MODEL_ID,
      tokensIn: u.inputTokens,
      tokensOut: u.outputTokens,
      tokensCached: u.cachedInputTokens,
      text,
    };
    return;
  }

  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
  const signal = req.abortSignal ? AbortSignal.any([req.abortSignal, timeout]) : timeout;

  try {
    const result = streamText({
      model: resolveModel(modelId),
      system: req.system,
      messages: withAttachments(req.messages, req.attachments),
      abortSignal: signal,
      providerOptions: providerOptionsFor(modelId, req),
    });

    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        yield { type: "delta", text: part.text };
      } else if (part.type === "reasoning-delta") {
        yield { type: "reasoning", text: part.text };
      } else if (part.type === "error") {
        yield { type: "error", message: sanitizeError(part.error) };
        return;
      }
    }
    const usage = readUsage((await result.usage) as UsageLike);
    await recordUsage({
      userId: req.viewer.effectiveUserId,
      feature: req.feature,
      model: modelId,
      ...usage,
    });
    yield { type: "done", model: modelId, ...usage, text };
  } catch (err) {
    yield { type: "error", message: sanitizeError(err) };
  }
}

/**
 * Non-streaming, schema-validated JSON generation. Retries once with the
 * validation error appended to the prompt; validates size-capped output with
 * Zod BEFORE anything touches the DB (spec doc 11 M5).
 */
export async function generateJson<T>(req: JsonRequest<T>, opts: { timezone?: string } = {}): Promise<{
  value: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}> {
  const modelId = req.model ?? defaultModelFor(req.feature);
  await checkQuota(req, opts.timezone ?? "UTC");

  if (envFlags.llmMock() || modelId.startsWith("mock/")) {
    const parsed = req.schema.parse(mockJsonValue(req.feature));
    const u = mockUsage();
    await recordUsage({
      userId: req.viewer.effectiveUserId,
      feature: req.feature,
      model: MOCK_MODEL_ID,
      tokensIn: u.inputTokens,
      tokensOut: u.outputTokens,
      tokensCached: u.cachedInputTokens,
    });
    return {
      value: parsed,
      model: MOCK_MODEL_ID,
      tokensIn: u.inputTokens,
      tokensOut: u.outputTokens,
      tokensCached: u.cachedInputTokens,
    };
  }

  const retries = req.retries ?? 1;
  let lastError: unknown;
  let messages = withAttachments(req.messages, req.attachments);
  let totals = { tokensIn: 0, tokensOut: 0, tokensCached: 0 };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
    const signal = req.abortSignal ? AbortSignal.any([req.abortSignal, timeout]) : timeout;
    try {
      const result = await generateText({
        model: resolveModel(modelId),
        system:
          req.system +
          "\n\nRespond ONLY with a valid JSON object matching the requested structure. No prose, no markdown fences.",
        messages,
        abortSignal: signal,
        providerOptions: providerOptionsFor(modelId, req),
      });
      const usage = readUsage(result.usage as UsageLike);
      totals = {
        tokensIn: totals.tokensIn + usage.tokensIn,
        tokensOut: totals.tokensOut + usage.tokensOut,
        tokensCached: totals.tokensCached + usage.tokensCached,
      };
      const raw = extractJson(result.text);
      const parsed = req.schema.safeParse(raw);
      if (parsed.success) {
        await recordUsage({
          userId: req.viewer.effectiveUserId,
          feature: req.feature,
          model: modelId,
          ...totals,
        });
        return { value: parsed.data, model: modelId, ...totals };
      }
      lastError = parsed.error;
      messages = [
        ...messages,
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your previous response failed validation with:\n${parsed.error.message}\nRespond again with ONLY the corrected JSON.`,
        },
      ];
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
    }
  }
  await recordUsage({
    userId: req.viewer.effectiveUserId,
    feature: req.feature,
    model: modelId,
    ...totals,
  });
  throw lastError instanceof Error ? lastError : new Error("llm_json_failed");
}


/** Error envelope: never leak provider internals to the client (doc 11 M3). */
function sanitizeError(err: unknown): string {
  if (err instanceof LlmConfigError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return "The request was cancelled or timed out.";
  return "The AI provider returned an error. Try again or switch models.";
}
