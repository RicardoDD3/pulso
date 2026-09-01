import { __resetEnvCache } from "@/lib/env";

const BASE_ENV = {
  DATABASE_URL: "postgres://test",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

function loadFeatures(env: Record<string, string>) {
  jest.resetModules();
  const previous = process.env;
  process.env = { NODE_ENV: "test", ...BASE_ENV, ...env } as NodeJS.ProcessEnv;
  __resetEnvCache();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFeatures } = require("@/lib/system/features");
  const features = getFeatures();
  process.env = previous;
  __resetEnvCache();
  return features;
}

describe("getFeatures", () => {
  it("no LLM keys → pure tracking mode: all AI features off", () => {
    const f = loadFeatures({});
    expect(f.chatEnabled).toBe(false);
    expect(f.aiPlansEnabled).toBe(false);
    expect(f.labsExtractionEnabled).toBe(false);
    expect(f.configuredProviders).toEqual([]);
  });

  it("one provider key enables chat but not labs extraction without VISION_MODEL", () => {
    const f = loadFeatures({ DEEPSEEK_API_KEY: "sk-x" });
    expect(f.chatEnabled).toBe(true);
    expect(f.labsExtractionEnabled).toBe(false);
    expect(f.configuredProviders).toContain("deepseek");
  });

  it("VISION_MODEL + a provider enables labs extraction", () => {
    const f = loadFeatures({
      ANTHROPIC_API_KEY: "sk-x",
      VISION_MODEL: "anthropic/claude-sonnet-5",
    });
    expect(f.labsExtractionEnabled).toBe(true);
  });

  it("LLM_MOCK=1 counts as a provider (CI never hits real providers)", () => {
    const f = loadFeatures({ LLM_MOCK: "1" });
    expect(f.chatEnabled).toBe(true);
    expect(f.configuredProviders).toEqual(["mock"]);
  });

  it("OW config enables wearables", () => {
    expect(loadFeatures({}).wearablesEnabled).toBe(false);
    const f = loadFeatures({ OW_API_URL: "http://ow:8000", OW_API_KEY: "k" });
    expect(f.wearablesEnabled).toBe(true);
  });
});
