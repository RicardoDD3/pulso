import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom ships without TextEncoder/TextDecoder; several pure modules use them.
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
