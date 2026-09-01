import { __resetEnvCache } from "@/lib/env";

function loadEnv(env: Record<string, string | undefined>) {
  jest.resetModules();
  const previous = process.env;
  process.env = { ...env } as NodeJS.ProcessEnv;
  __resetEnvCache();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getEnv } = require("@/lib/env");
  try {
    return getEnv();
  } finally {
    process.env = previous;
    __resetEnvCache();
  }
}

describe("env validation", () => {
  const valid = {
    DATABASE_URL: "postgres://pulso:pulso@localhost:5432/pulso",
    AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  };

  it("accepts a minimal valid env and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.DEFAULT_CHAT_MODEL).toBe("deepseek/deepseek-chat");
    expect(env.HEALTH_WINDOW_DAYS).toBe(90);
    expect(env.LLM_DAILY_TOKEN_LIMIT).toBe(2_000_000);
  });

  it("fails with a clear message when DATABASE_URL is missing", () => {
    expect(() => loadEnv({ AUTH_SECRET: valid.AUTH_SECRET })).toThrow(/DATABASE_URL/);
  });

  it("fails when AUTH_SECRET is too short", () => {
    expect(() => loadEnv({ ...valid, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("coerces numeric limits from strings", () => {
    const env = loadEnv({ ...valid, LLM_DAILY_TOKEN_LIMIT: "500000" });
    expect(env.LLM_DAILY_TOKEN_LIMIT).toBe(500_000);
  });
});
