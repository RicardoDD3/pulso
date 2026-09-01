import { versionsToPrune, latestVersion } from "@/lib/training/plan-versions";

const rows = (ids: number[]) =>
  ids.map((id) => ({ id, created_at: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z` }));

describe("versionsToPrune", () => {
  it("no poda si hay <= keep", () => {
    expect(versionsToPrune(rows([1, 2, 3]), 10)).toEqual([]);
  });
  it("poda las más viejas dejando las 'keep' más recientes", () => {
    expect(versionsToPrune(rows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 10).sort((a, b) => a - b)).toEqual([1, 2]);
  });
  it("keep por defecto es 10", () => {
    expect(versionsToPrune(rows(Array.from({ length: 11 }, (_, i) => i + 1))).sort((a, b) => a - b)).toEqual([1]);
  });
});

describe("latestVersion", () => {
  it("devuelve la de created_at más reciente", () => {
    expect(latestVersion(rows([1, 5, 3]))!.id).toBe(5);
  });
  it("devuelve null con lista vacía", () => {
    expect(latestVersion([])).toBeNull();
  });
});
