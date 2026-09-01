import { extractJson } from "@/lib/llm/json";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers an object embedded in prose", () => {
    expect(extractJson('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
  });

  it("returns null for garbage", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});
