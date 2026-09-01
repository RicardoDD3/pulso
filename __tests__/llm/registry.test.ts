import {
  estimateCostUsd,
  findModelInfo,
  parseModelId,
} from "@/lib/llm/registry";

describe("parseModelId", () => {
  it("splits provider/model", () => {
    expect(parseModelId("deepseek/deepseek-chat")).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("keeps slashes inside the model part", () => {
    expect(parseModelId("openai-compatible/org/model:tag")).toEqual({
      provider: "openai-compatible",
      model: "org/model:tag",
    });
  });

  it("rejects ids without a provider or model", () => {
    expect(parseModelId("deepseek")).toBeNull();
    expect(parseModelId("/model")).toBeNull();
    expect(parseModelId("provider/")).toBeNull();
  });
});

describe("findModelInfo", () => {
  it("finds exact catalog entries", () => {
    expect(findModelInfo("deepseek/deepseek-chat")?.label).toBe("DeepSeek Chat");
  });

  it("falls back to the provider wildcard", () => {
    const info = findModelInfo("ollama/llama3.3:70b");
    expect(info?.provider).toBe("ollama");
    expect(info?.model).toBe("*");
  });

  it("returns null for unknown providers", () => {
    expect(findModelInfo("nope/whatever")).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("computes from per-Mtok prices", () => {
    // deepseek-chat: 0.27 in / 1.1 out per Mtok
    const cost = estimateCostUsd("deepseek/deepseek-chat", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.37, 5);
  });

  it("returns 0-cost for local providers", () => {
    expect(estimateCostUsd("ollama/llama3.3", 50_000, 5_000)).toBe(0);
  });

  it("returns null when the model is unknown", () => {
    expect(estimateCostUsd("unknown/x", 1000, 1000)).toBeNull();
  });
});
