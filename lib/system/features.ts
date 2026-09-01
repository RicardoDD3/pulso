/**
 * Feature flags derived from the environment (spec docs 01/05).
 *
 * Components and routes consult these flags — never process.env directly.
 * Every feature declares its dependencies and the app serves without them
 * (graceful degradation, spec doc 00).
 */
import { getEnv, envFlags } from "@/lib/env";

export type Features = {
  /** ≥1 LLM provider configured (or mock) → chats available. */
  chatEnabled: boolean;
  /** A model able to produce large reliable JSON → AI plan generation.
   *  Deterministic plan generation works ALWAYS, without any LLM. */
  aiPlansEnabled: boolean;
  /** A vision-capable model configured → labs PDF extraction. */
  labsExtractionEnabled: boolean;
  /** Open Wearables connection configured → wearable sync. */
  wearablesEnabled: boolean;
  /** Any configured provider ids, for the model picker. */
  configuredProviders: string[];
};

export function getFeatures(): Features {
  const env = getEnv();
  const providers: string[] = [];
  if (envFlags.llmMock()) providers.push("mock");
  if (env.OPENAI_API_KEY) providers.push("openai");
  if (env.ANTHROPIC_API_KEY) providers.push("anthropic");
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) providers.push("google");
  if (env.DEEPSEEK_API_KEY) providers.push("deepseek");
  if (env.OLLAMA_BASE_URL) providers.push("ollama");
  if (env.OPENAI_COMPATIBLE_BASE_URL) providers.push("openai-compatible");

  const chatEnabled = providers.length > 0;
  return {
    chatEnabled,
    aiPlansEnabled: chatEnabled && Boolean(env.PLAN_MODEL ?? env.DEFAULT_CHAT_MODEL),
    labsExtractionEnabled: Boolean(env.VISION_MODEL) && chatEnabled,
    wearablesEnabled: Boolean(env.OW_API_URL && env.OW_API_KEY),
    configuredProviders: providers,
  };
}
