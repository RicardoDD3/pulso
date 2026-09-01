import { startOfTodayInTz } from "@/lib/llm/usage";

describe("startOfTodayInTz", () => {
  it("resolves local midnight for a UTC-6 timezone", () => {
    // 2026-01-15 03:00 UTC == 2026-01-14 21:00 in Mexico City (UTC-6)
    const now = new Date("2026-01-15T03:00:00Z");
    const start = startOfTodayInTz("America/Mexico_City", now);
    // Local midnight of Jan 14 → 06:00 UTC of Jan 14
    expect(start.toISOString()).toBe("2026-01-14T06:00:00.000Z");
  });

  it("resolves midnight for UTC", () => {
    const now = new Date("2026-01-15T03:00:00Z");
    expect(startOfTodayInTz("UTC", now).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("quota reset boundary: just before vs just after local midnight", () => {
    const before = startOfTodayInTz("America/Mexico_City", new Date("2026-01-15T05:59:00Z"));
    const after = startOfTodayInTz("America/Mexico_City", new Date("2026-01-15T06:01:00Z"));
    expect(before.toISOString()).toBe("2026-01-14T06:00:00.000Z");
    expect(after.toISOString()).toBe("2026-01-15T06:00:00.000Z");
  });
});
