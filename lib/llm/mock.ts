/**
 * Mock provider fixtures (spec doc 12): activated with LLM_MOCK=1.
 * CI NEVER hits real providers. Fixtures per feature.
 */
import type { LlmFeature } from "./types";

export const MOCK_MODEL_ID = "mock/mock-1";

const CHAT_FIXTURES: Record<LlmFeature, string> = {
  coach:
    "Mock coach reply: based on your recent data, sleep and HRV look stable. (LLM_MOCK fixture)",
  tracking: "Mock tracking reply: this week you completed 3 of 4 planned sessions. (LLM_MOCK fixture)",
  planner: '{"action":"answer","message":"Mock planner reply. (LLM_MOCK fixture)"}',
  plan_generation: "Mock plan generation. (LLM_MOCK fixture)",
  labs_extraction: "Mock labs extraction. (LLM_MOCK fixture)",
};

export function mockChatText(feature: LlmFeature): string {
  return CHAT_FIXTURES[feature];
}

/** Minimal valid objects per feature for generateJson in mock mode.
 *  Feature schemas parse these; tests can override via param injection. */
export function mockJsonValue(feature: LlmFeature): unknown {
  switch (feature) {
    case "labs_extraction":
      // Matches lib/labs/schema.ts (the compact extraction schema).
      return {
        patient: { name: null, dob: null, sex: null, age: null },
        lab: { name: "Mock Lab", location: "Mock City", doctor: null },
        sample_date: "2026-01-15",
        results: [
          {
            cat: "GM",
            name: "Glucosa",
            key: "glucose",
            val: 92,
            txt: null,
            unit: "mg/dL",
            rmin: 70,
            rmax: 100,
            rtxt: null,
            flag: false,
          },
          {
            cat: "TIR",
            name: "TSH",
            key: "tsh",
            val: 2.4,
            txt: null,
            unit: "µIU/mL",
            rmin: 0.4,
            rmax: 4.5,
            rtxt: null,
            flag: false,
          },
        ],
      };
    case "planner":
      return { action: "answer", message: "Mock planner action. (LLM_MOCK fixture)" };
    default:
      return { ok: true, fixture: true };
  }
}

export function mockUsage() {
  return { inputTokens: 1200, outputTokens: 180, cachedInputTokens: 0 };
}
