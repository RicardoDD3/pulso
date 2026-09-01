/**
 * Environment validation (spec doc 01).
 *
 * The app validates env at startup and fails with a clear message when a
 * required variable is missing. Features never read process.env directly —
 * they consult lib/system/features.ts, which derives flags from this module.
 */
import { z } from "zod";

const envSchema = z.object({
  // --- Core ---
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (postgres://…)"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars (openssl rand -hex 32)"),

  // --- Open Wearables ---
  OW_API_URL: z.string().url().optional(),
  OW_API_KEY: z.string().optional(),
  OW_WEBHOOK_SECRET: z.string().optional(),

  // --- LLM (all optional; none configured → pure tracking mode) ---
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  DEFAULT_CHAT_MODEL: z.string().default("deepseek/deepseek-chat"),
  PLAN_MODEL: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  LLM_MOCK: z.string().optional(),

  // --- Auth policy ---
  REQUIRE_EMAIL_VERIFICATION: z.string().default("false"),
  SIGNUPS_DISABLED: z.string().default("false"),
  ADMIN_EMAIL: z.string().email().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // --- Limits / retention ---
  LLM_DAILY_TOKEN_LIMIT: z.coerce.number().int().nonnegative().default(2_000_000),
  MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(60_000),
  HEALTH_WINDOW_DAYS: z.coerce.number().int().positive().default(90),
  SAMPLES_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0), // 0 = infinite
  RATE_LIMIT_DISABLED: z.string().default("false"),

  // --- Optional ---
  SEED_DEMO: z.string().default("false"),
  SENTRY_DSN: z.string().optional(),
  UPLOADS_DIR: z.string().default("/data/uploads"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

function bool(v: string): boolean {
  return v === "true" || v === "1";
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only escape hatch. */
export function __resetEnvCache(): void {
  cached = null;
}

export const envFlags = {
  requireEmailVerification: () => bool(getEnv().REQUIRE_EMAIL_VERIFICATION),
  signupsDisabled: () => bool(getEnv().SIGNUPS_DISABLED),
  rateLimitDisabled: () => bool(getEnv().RATE_LIMIT_DISABLED),
  seedDemo: () => bool(getEnv().SEED_DEMO),
  llmMock: () => bool(getEnv().LLM_MOCK ?? "false"),
};
