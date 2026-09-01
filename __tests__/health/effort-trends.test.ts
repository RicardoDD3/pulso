import {
  paceMinKmNum,
  gapPaceMinKmNum,
  buildTrainingEffectSeries,
  buildTrainingLoadSeries,
  buildGapSeries,
  pairWeatherPerformance,
} from "@/lib/health/effort-trends";

describe("pace helpers (decimal min/km)", () => {
  it("paceMinKmNum computes decimal minutes per km", () => {
    // 10000m in 3000s → 5.0 min/km
    expect(paceMinKmNum(10000, 3000)).toBeCloseTo(5);
    expect(paceMinKmNum(0, 3000)).toBeNull();
    expect(paceMinKmNum(10000, 0)).toBeNull();
    expect(paceMinKmNum(null, null)).toBeNull();
  });
  it("gapPaceMinKmNum converts m/s to decimal min/km", () => {
    // 2.5 m/s → 400s/km → 6.667 min/km
    expect(gapPaceMinKmNum(2.5)).toBeCloseTo(6.6667, 3);
    expect(gapPaceMinKmNum(0)).toBeNull();
  });
});

describe("buildTrainingEffectSeries", () => {
  it("keeps only runs with any TE and preserves date order", () => {
    const out = buildTrainingEffectSeries([
      { date: "2026-07-18", aerobic_training_effect: 3, anaerobic_training_effect: 0 },
      { date: "2026-07-19", aerobic_training_effect: 5, anaerobic_training_effect: 1.3 },
      { date: "2026-07-01", aerobic_training_effect: null, anaerobic_training_effect: null }, // old, dropped
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ date: "2026-07-18", aerobic: 3, anaerobic: 0 });
    expect(out[1].aerobic).toBe(5);
  });
});

describe("buildTrainingLoadSeries", () => {
  it("reads activityTrainingLoad from raw_summary", () => {
    const out = buildTrainingLoadSeries([
      { date: "2026-07-19", raw_summary: { activityTrainingLoad: 661.5 } },
      { date: "2026-07-18", raw_summary: { activityTrainingLoad: 66.6 } },
      { date: "2026-07-01", raw_summary: null }, // dropped
      { date: "2026-07-02" }, // dropped
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].load).toBeCloseTo(661.5);
  });
});

describe("buildGapSeries", () => {
  it("emits GAP + real pace only for runs with GAP data", () => {
    const out = buildGapSeries([
      { date: "2026-07-19", avg_grade_adjusted_speed_mps: 2.915, distance_meters: 10000, duration_seconds: 3000 },
      { date: "2026-07-01", avg_grade_adjusted_speed_mps: null, distance_meters: 5000, duration_seconds: 1800 }, // dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].gapPace).toBeCloseTo(5.716, 2); // 1000/2.915/60
    expect(out[0].realPace).toBeCloseTo(5);
  });
});

describe("pairWeatherPerformance", () => {
  it("joins runs with weather by activity_id and converts temp to °C", () => {
    const runs = [
      { date: "2026-07-14", activity_id: 111, distance_meters: 10000, duration_seconds: 3000, avg_hr: 140 },
      { date: "2026-07-15", activity_id: 222, distance_meters: 8000, duration_seconds: 2400, avg_hr: 150 }, // no weather
    ];
    const weather = [{ activity_id: 111, temp: 57, relative_humidity: 77 }];
    const out = pairWeatherPerformance(runs, weather);
    expect(out).toHaveLength(1);
    expect(out[0].tempC).toBeCloseTo(13.89, 2);
    expect(out[0].pace).toBeCloseTo(5);
    expect(out[0].hr).toBe(140);
    expect(out[0].humidity).toBe(77);
  });
  it("coerces string activity_id (PostgREST) on both sides", () => {
    const out = pairWeatherPerformance(
      [{ date: "2026-07-14", activity_id: "111", distance_meters: 10000, duration_seconds: 3000 }],
      [{ activity_id: "111", temp: 68 }]
    );
    expect(out).toHaveLength(1);
    expect(out[0].tempC).toBeCloseTo(20);
  });
});
