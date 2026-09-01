# Choosing LLM models (BYOK)

Pulso works with zero LLM keys (tracking + deterministic training plans).
Keys unlock: AI coach chats, natural-language plan editing, AI plan
generation, and lab PDF extraction.

## The three model knobs

| Env | Used for | Needs |
|---|---|---|
| `DEFAULT_CHAT_MODEL` | Coach/tracking chats | Long context; cheap input tokens |
| `PLAN_MODEL` | Plan generation/modification | Reliable large JSON output |
| `VISION_MODEL` | Lab PDF extraction | Vision + PDF input |

Format: `provider/model`, e.g. `deepseek/deepseek-chat`,
`anthropic/claude-sonnet-5`, `google/gemini-3-flash`, `ollama/llama3.3`.

## Why the default is DeepSeek

The coach's system prompt carries your health context — measured at ~30–50k
tokens in production use. That input cost dominates everything. DeepSeek
caches repeated prefixes implicitly and its input price is ~10× lower than
premium models, so a chatty month costs cents instead of dollars. Anthropic
models get `cache_control` automatically on large prompts; OpenAI gets a
stable `prompt_cache_key` per user+feature.

Rough monthly cost per active user (30 chat messages/day, 40k-token context,
with provider caching):

| Setup | Est. cost/month |
|---|---|
| deepseek-chat everywhere | ≈ $1–2 |
| gemini-3-flash | ≈ $3–6 |
| claude-sonnet-5 chats | ≈ $15–30 |
| Ollama (local) | $0 |

Verify with your own traffic: Settings shows per-user token usage and cost
estimates (from `llm_usage`).

## Quotas

`LLM_DAILY_TOKEN_LIMIT` (default 2M tokens/user/day) returns a clean 429 when
exceeded and resets at the user's local midnight. Without limits, a public
instance with your key is an open credit card — keep it on.

## Fully local

`OLLAMA_BASE_URL=http://host.docker.internal:11434` +
`DEFAULT_CHAT_MODEL=ollama/llama3.3` → nothing ever leaves your machines.
Any OpenAI-compatible server (vLLM, LM Studio, llama.cpp) works via
`OPENAI_COMPATIBLE_BASE_URL`.
