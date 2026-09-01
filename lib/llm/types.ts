import type { ModelMessage } from "ai";
import type { ZodType } from "zod";
import type { Viewer } from "@/lib/authz/viewer";

export type LlmFeature = "coach" | "tracking" | "planner" | "plan_generation" | "labs_extraction";

export type Attachment = {
  /** media type, e.g. application/pdf or image/png */
  mediaType: string;
  /** raw bytes */
  data: Uint8Array;
  filename?: string;
};

export type ChatRequest = {
  feature: LlmFeature;
  viewer: Viewer;
  /** "provider/model"; undefined → instance default for the feature. */
  model?: string;
  system: string;
  messages: ModelMessage[];
  attachments?: Attachment[];
  abortSignal?: AbortSignal;
};

export type JsonRequest<T> = ChatRequest & {
  schema: ZodType<T>;
  /** max retries when the model output fails schema validation (default 1) */
  retries?: number;
};

export type ChatChunk =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "error"; message: string }
  | {
      type: "done";
      model: string;
      tokensIn: number;
      tokensOut: number;
      tokensCached: number;
      text: string;
    };

export class LlmConfigError extends Error {}

export class QuotaExceededError extends Error {
  constructor() {
    super("quota_exceeded");
  }
}
