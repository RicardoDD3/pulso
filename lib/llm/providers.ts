/**
 * Provider resolution (spec doc 05): "provider/model" string → AI SDK model.
 * Adding a provider = registering it here + in the registry. No new routes.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getEnv } from "@/lib/env";
import { parseModelId } from "./registry";
import { LlmConfigError } from "./types";

export { LlmConfigError } from "./types";

export function resolveModel(id: string): LanguageModel {
  const parsed = parseModelId(id);
  if (!parsed) throw new LlmConfigError(`Invalid model id "${id}" — expected "provider/model"`);
  const env = getEnv();
  const { provider, model } = parsed;

  switch (provider) {
    case "openai": {
      if (!env.OPENAI_API_KEY) throw new LlmConfigError("OPENAI_API_KEY is not configured");
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(model);
    }
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) throw new LlmConfigError("ANTHROPIC_API_KEY is not configured");
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model);
    }
    case "google": {
      if (!env.GOOGLE_GENERATIVE_AI_API_KEY)
        throw new LlmConfigError("GOOGLE_GENERATIVE_AI_API_KEY is not configured");
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(model);
    }
    case "deepseek": {
      if (!env.DEEPSEEK_API_KEY) throw new LlmConfigError("DEEPSEEK_API_KEY is not configured");
      return createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY })(model);
    }
    case "ollama": {
      if (!env.OLLAMA_BASE_URL) throw new LlmConfigError("OLLAMA_BASE_URL is not configured");
      return createOpenAICompatible({
        name: "ollama",
        baseURL: `${env.OLLAMA_BASE_URL.replace(/\/$/, "")}/v1`,
      })(model);
    }
    case "openai-compatible": {
      if (!env.OPENAI_COMPATIBLE_BASE_URL)
        throw new LlmConfigError("OPENAI_COMPATIBLE_BASE_URL is not configured");
      return createOpenAICompatible({
        name: "openai-compatible",
        baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
        apiKey: env.OPENAI_COMPATIBLE_API_KEY,
      })(model);
    }
    default:
      throw new LlmConfigError(`Unknown provider "${provider}"`);
  }
}
