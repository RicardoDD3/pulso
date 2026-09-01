/**
 * mergeHealthDay (spec doc 02): resolves the "effective" day when a user has
 * multiple providers. The primary provider wins field by field; the rest fill
 * NULLs in deterministic order (alphabetical by provider). Features consume
 * the merge, never the raw per-provider rows.
 */
import type { HealthDayRow } from "@/lib/db/schema";

export type MergedHealthDay = Omit<HealthDayRow, "id" | "provider" | "raw"> & {
  /** providers that contributed at least one field */
  providers: string[];
};

const MERGE_FIELDS = [
  "steps",
  "floors",
  "intensityMinutes",
  "distanceM",
  "caloriesTotal",
  "caloriesActive",
  "restingHr",
  "hrMin",
  "hrMax",
  "stressAvg",
  "stressMax",
  "bodyBatteryHigh",
  "bodyBatteryLow",
  "spo2Avg",
  "respirationAvg",
  "hrvMs",
  "hrvStatus",
  "hydrationMl",
] as const;

type MergeField = (typeof MERGE_FIELDS)[number];

export function mergeHealthDay(
  rows: HealthDayRow[],
  primaryProvider: string | null,
): MergedHealthDay | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => {
    if (a.provider === primaryProvider) return -1;
    if (b.provider === primaryProvider) return 1;
    return a.provider.localeCompare(b.provider);
  });

  const base = ordered[0];
  const merged: MergedHealthDay = {
    userId: base.userId,
    date: base.date,
    providers: [],
    steps: null,
    floors: null,
    intensityMinutes: null,
    distanceM: null,
    caloriesTotal: null,
    caloriesActive: null,
    restingHr: null,
    hrMin: null,
    hrMax: null,
    stressAvg: null,
    stressMax: null,
    bodyBatteryHigh: null,
    bodyBatteryLow: null,
    spo2Avg: null,
    respirationAvg: null,
    hrvMs: null,
    hrvStatus: null,
    hydrationMl: null,
  };

  const contributors = new Set<string>();
  for (const row of ordered) {
    for (const field of MERGE_FIELDS) {
      if (merged[field] == null && row[field] != null) {
        (merged as Record<MergeField, unknown>)[field] = row[field];
        contributors.add(row.provider);
      }
    }
  }
  merged.providers = ordered.map((r) => r.provider).filter((p) => contributors.has(p));
  return merged;
}
