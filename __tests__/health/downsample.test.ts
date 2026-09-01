import { downsampleRoute, MAX_ROUTE_POINTS } from "@/lib/health/downsample";

describe("downsampleRoute", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("returns short tracks untouched", () => {
    const pts = mk(500);
    expect(downsampleRoute(pts)).toBe(pts);
  });

  it("caps at MAX_ROUTE_POINTS", () => {
    expect(downsampleRoute(mk(10_000)).length).toBe(MAX_ROUTE_POINTS);
  });

  it("always keeps the exact first and last points", () => {
    const out = downsampleRoute(mk(7777), 100);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(7776);
    expect(out.length).toBe(100);
  });

  it("keeps points in order without duplicates for reasonable sizes", () => {
    const out = downsampleRoute(mk(5000), 1000);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
  });

  it("handles exactly max+1 points", () => {
    const out = downsampleRoute(mk(101), 100);
    expect(out.length).toBe(100);
    expect(out[0]).toBe(0);
    expect(out[99]).toBe(100);
  });
});
