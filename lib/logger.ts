/**
 * Structured logging (spec doc 01). Policy: log ids and counts only — NEVER
 * chat message content, lab values, or health metrics (they are health data).
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["content", "message.content", "*.password", "*.token", "*.apiKey"],
    remove: true,
  },
});
