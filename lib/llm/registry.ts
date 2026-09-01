/**
 * Model registry (spec doc 05) — static versioned catalog per provider:
 * capabilities + rough pricing for cost estimates. A live list-models refresh
 * can layer on top later (pattern from the original's lib/models/latest.ts);
 * the static catalog is always the fallback.
 *
 * Prices are USD per million tokens (input/output) — estimates for the cost
 * panel, not billing.
 */
export type ModelInfo = {
  /** "provider/model" */
  id: string;
  provider: string;
  model: string;
  label: string;
  vision: boolean;
  jsonReliable: boolean;
  priceInPerMtok: number | null;
  priceOutPerMtok: number | null;
};

const M = (
  provider: string,
  model: string,
  label: string,
  opts: Partial<Omit<ModelInfo, "id" | "provider" | "model" | "label">> = {},
): ModelInfo => ({
  id: `${provider}/${model}`,
  provider,
  model,
  label,
  vision: false,
  jsonReliable: false,
  priceInPerMtok: null,
  priceOutPerMtok: null,
  ...opts,
});

export const MODEL_CATALOG: ModelInfo[] = [
  // OpenAI
  M("openai", "gpt-5.2", "GPT-5.2", { vision: true, jsonReliable: true, priceInPerMtok: 1.25, priceOutPerMtok: 10 }),
  M("openai", "gpt-5-mini", "GPT-5 mini", { vision: true, jsonReliable: true, priceInPerMtok: 0.25, priceOutPerMtok: 2 }),
  // Anthropic
  M("anthropic", "claude-sonnet-5", "Claude Sonnet 5", { vision: true, jsonReliable: true, priceInPerMtok: 3, priceOutPerMtok: 15 }),
  M("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5", { vision: true, jsonReliable: true, priceInPerMtok: 1, priceOutPerMtok: 5 }),
  M("anthropic", "claude-opus-5", "Claude Opus 5", { vision: true, jsonReliable: true, priceInPerMtok: 5, priceOutPerMtok: 25 }),
  // Google
  M("google", "gemini-3-flash", "Gemini 3 Flash", { vision: true, jsonReliable: true, priceInPerMtok: 0.3, priceOutPerMtok: 2.5 }),
  M("google", "gemini-3-pro", "Gemini 3 Pro", { vision: true, jsonReliable: true, priceInPerMtok: 2, priceOutPerMtok: 12 }),
  // DeepSeek (implicit prefix caching → cheap default for long system prompts)
  M("deepseek", "deepseek-chat", "DeepSeek Chat", { jsonReliable: true, priceInPerMtok: 0.27, priceOutPerMtok: 1.1 }),
  M("deepseek", "deepseek-reasoner", "DeepSeek Reasoner", { priceInPerMtok: 0.55, priceOutPerMtok: 2.19 }),
  // Local — capabilities depend on the actual model; priced at 0
  M("ollama", "*", "Ollama (local)", { priceInPerMtok: 0, priceOutPerMtok: 0 }),
  M("openai-compatible", "*", "OpenAI-compatible endpoint", { priceInPerMtok: 0, priceOutPerMtok: 0 }),
  // Test fixture provider (LLM_MOCK=1); CI never hits real providers
  M("mock", "*", "Mock", { vision: true, jsonReliable: true, priceInPerMtok: 0, priceOutPerMtok: 0 }),
];

export function parseModelId(id: string): { provider: string; model: string } | null {
  const idx = id.indexOf("/");
  if (idx <= 0 || idx === id.length - 1) return null;
  return { provider: id.slice(0, idx), model: id.slice(idx + 1) };
}

export function findModelInfo(id: string): ModelInfo | null {
  const parsed = parseModelId(id);
  if (!parsed) return null;
  return (
    MODEL_CATALOG.find((m) => m.id === id) ??
    MODEL_CATALOG.find((m) => m.provider === parsed.provider && m.model === "*") ??
    null
  );
}

/** Rough USD estimate for a call; null when the price is unknown. */
export function estimateCostUsd(
  id: string,
  tokensIn: number,
  tokensOut: number,
): number | null {
  const info = findModelInfo(id);
  if (!info || info.priceInPerMtok == null || info.priceOutPerMtok == null) return null;
  return (tokensIn * info.priceInPerMtok + tokensOut * info.priceOutPerMtok) / 1_000_000;
}
