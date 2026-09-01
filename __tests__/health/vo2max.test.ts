import { extractVo2maxTrend, latestVo2max } from "@/lib/health/vo2max";

const act = (date: string, vo2max_value: number | null, extra: Record<string, unknown> = {}) => ({
  activity_id: Math.floor(Math.random() * 1e9),
  date,
  activity_type: "running",
  vo2max_value,
  ...extra,
});

describe("extractVo2maxTrend", () => {
  it("returns one point per date with vo2max, sorted ascending", () => {
    const activities = [
      act("2026-07-04", 45),
      act("2026-07-11", 47),
      act("2026-07-08", 44),
    ];
    expect(extractVo2maxTrend(activities)).toEqual([
      { date: "2026-07-04", vo2max: 45 },
      { date: "2026-07-08", vo2max: 44 },
      { date: "2026-07-11", vo2max: 47 },
    ]);
  });

  it("skips activities without vo2max_value (null or undefined)", () => {
    const activities = [
      act("2026-07-04", null),
      act("2026-07-05", 45),
      { activity_id: 1, date: "2026-07-06", activity_type: "walking" },
    ];
    expect(extractVo2maxTrend(activities)).toEqual([{ date: "2026-07-05", vo2max: 45 }]);
  });

  it("keeps the last value when a date has multiple activities", () => {
    const activities = [
      act("2026-07-04", 44),
      act("2026-07-04", 46),
    ];
    expect(extractVo2maxTrend(activities)).toEqual([{ date: "2026-07-04", vo2max: 46 }]);
  });

  it("returns empty array for empty or all-null input", () => {
    expect(extractVo2maxTrend([])).toEqual([]);
    expect(extractVo2maxTrend([act("2026-07-04", null)])).toEqual([]);
  });
});

describe("latestVo2max", () => {
  it("returns the most recent vo2max point", () => {
    const activities = [
      act("2026-07-04", 45),
      act("2026-07-11", 47),
      act("2026-07-08", 44),
    ];
    expect(latestVo2max(activities)).toEqual({ date: "2026-07-11", vo2max: 47 });
  });

  it("respects the upToDate cutoff (inclusive)", () => {
    const activities = [
      act("2026-07-04", 45),
      act("2026-07-11", 47),
    ];
    expect(latestVo2max(activities, "2026-07-04")).toEqual({ date: "2026-07-04", vo2max: 45 });
    expect(latestVo2max(activities, "2026-07-10")).toEqual({ date: "2026-07-04", vo2max: 45 });
    expect(latestVo2max(activities, "2026-07-11")).toEqual({ date: "2026-07-11", vo2max: 47 });
  });

  it("returns null when no vo2max exists before the cutoff", () => {
    const activities = [act("2026-07-11", 47)];
    expect(latestVo2max(activities, "2026-07-01")).toBeNull();
    expect(latestVo2max([])).toBeNull();
  });
});
