import {
  toNum,
  activityDetailUrl,
  speedMpsToPaceMinKm,
  intensityLabelEs,
  splitTypeLabelEs,
  teLabelEs,
  normalizeLap,
  summarizeSplits,
  extractEffortMetrics,
  hasEffortData,
  parseHrZones,
} from "@/lib/health/activity-detail";

describe("toNum", () => {
  it("coerces string numerics from PostgREST", () => {
    expect(toNum("237")).toBe(237);
    expect(toNum("2.1")).toBeCloseTo(2.1);
  });
  it("keeps 0 as a real value", () => {
    expect(toNum(0)).toBe(0);
    expect(toNum("0")).toBe(0);
  });
  it("returns null for null/empty/NaN", () => {
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum("")).toBeNull();
    expect(toNum("abc")).toBeNull();
  });
});

describe("activityDetailUrl", () => {
  it("plain url without viewUser", () => {
    expect(activityDetailUrl(123)).toBe("/api/garmin/activity/123");
    expect(activityDetailUrl(123, "")).toBe("/api/garmin/activity/123");
  });
  it("prepends ? for a viewUser param that arrives as '&viewUser=...'", () => {
    // Regresión: sin ? la URL queda '/activity/123&viewUser=abc' y el server
    // no ve el viewUser → filtra por el usuario actual (0 datos) → sin laps.
    expect(activityDetailUrl(123, "&viewUser=abc")).toBe("/api/garmin/activity/123?viewUser=abc");
    expect(activityDetailUrl(123, "&viewUser=abc")).not.toContain("123&viewUser");
  });
  it("tolerates a param already starting with ?", () => {
    expect(activityDetailUrl(123, "?viewUser=abc")).toBe("/api/garmin/activity/123?viewUser=abc");
  });
});

describe("speedMpsToPaceMinKm", () => {
  it("converts m/s to m:ss per km", () => {
    // 2.5 m/s → 1000/2.5 = 400s/km → 6:40
    expect(speedMpsToPaceMinKm(2.5)).toBe("6:40");
  });
  it("pads seconds and carries into minutes cleanly", () => {
    // 2.10700 m/s → 474.6 → round 475s → 7:55
    expect(speedMpsToPaceMinKm(2.107)).toBe("7:55");
  });
  it("returns null for zero/negative/missing speed", () => {
    expect(speedMpsToPaceMinKm(0)).toBeNull();
    expect(speedMpsToPaceMinKm(-1)).toBeNull();
    expect(speedMpsToPaceMinKm(null)).toBeNull();
  });
});

describe("label maps", () => {
  it("maps intensity types to Spanish, unknown → em dash", () => {
    expect(intensityLabelEs("INTERVAL")).toBe("Intervalo");
    expect(intensityLabelEs("ACTIVE")).toBe("Activo");
    expect(intensityLabelEs("")).toBe("—");
    expect(intensityLabelEs(null)).toBe("—");
  });
  it("maps split types, falling back to prettified snake case", () => {
    expect(splitTypeLabelEs("RWD_RUN")).toBe("Corriendo");
    expect(splitTypeLabelEs("INTERVAL_RECOVERY")).toBe("Recuperación");
    expect(splitTypeLabelEs("SOME_NEW_TYPE")).toBe("Some new type");
  });
  it("maps training-effect labels, null when absent", () => {
    expect(teLabelEs("LACTATE_THRESHOLD")).toBe("Umbral láctico");
    expect(teLabelEs("AEROBIC_BASE")).toBe("Base aeróbica");
    expect(teLabelEs("")).toBeNull();
    expect(teLabelEs(null)).toBeNull();
    expect(teLabelEs("FUTURE_LABEL")).toBe("Future label");
  });
});

describe("normalizeLap", () => {
  it("normalizes a running lap with dynamics", () => {
    const lap = normalizeLap({
      lap_index: 1,
      intensity_type: "INTERVAL",
      distance_meters: 974.74,
      duration_seconds: 462.665,
      avg_hr: 122,
      max_hr: 156,
      avg_run_cadence_spm: 159.4,
      avg_power_w: 237,
      stride_length_cm: 78.63,
      vertical_oscillation_cm: 7.61,
      vertical_ratio: 9.74,
      ground_contact_time_ms: 290.4,
      elevation_gain_m: 13.73,
      elevation_loss_m: 31.49,
    });
    expect(lap.index).toBe(1);
    expect(lap.intensity).toBe("Intervalo");
    expect(lap.km).toBeCloseTo(0.97474);
    expect(lap.avgHr).toBe(122);
    expect(lap.powerW).toBe(237);
    expect(lap.strideCm).toBeCloseTo(78.63);
    // 974.74m in 462.665s → 2.1067 m/s → 475s/km → 7:55
    expect(lap.paceMinKm).toBe("7:55");
  });
  it("tolerates missing fields (nulls) without throwing", () => {
    const lap = normalizeLap({ lap_index: 2, intensity_type: null });
    expect(lap.km).toBeNull();
    expect(lap.paceMinKm).toBeNull();
    expect(lap.powerW).toBeNull();
    expect(lap.intensity).toBe("—");
  });
});

describe("summarizeSplits", () => {
  it("summarizes splitSummaries by type", () => {
    const out = summarizeSplits([
      { splitType: "RWD_RUN", distance: 10000, duration: 3000, noOfSplits: 4 },
      { splitType: "RWD_WALK", distance: 500, duration: 400, noOfSplits: 2 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("Corriendo");
    expect(out[0].km).toBe(10);
    expect(out[0].count).toBe(4);
    // 10000m / 3000s → 3.333 m/s → 300s/km → 5:00
    expect(out[0].paceMinKm).toBe("5:00");
    expect(out[1].label).toBe("Caminando");
  });
  it("falls back to averageSpeed when distance/duration missing", () => {
    const out = summarizeSplits([{ splitType: "RWD_RUN", averageSpeed: 2.5 }]);
    expect(out[0].paceMinKm).toBe("6:40");
    expect(out[0].km).toBeNull();
  });
  it("returns [] for non-array input", () => {
    expect(summarizeSplits(null)).toEqual([]);
    expect(summarizeSplits(undefined)).toEqual([]);
    expect(summarizeSplits("nope")).toEqual([]);
  });
});

describe("extractEffortMetrics", () => {
  it("pulls TE, load (from raw_summary), GAP and moving %", () => {
    const m = extractEffortMetrics({
      aerobic_training_effect: 5,
      anaerobic_training_effect: 1.3,
      avg_grade_adjusted_speed_mps: 2.915,
      moving_duration_seconds: 8417,
      elapsed_duration_seconds: 8439,
      duration_seconds: 8439,
      raw_summary: { activityTrainingLoad: 661.5, trainingEffectLabel: "LACTATE_THRESHOLD" },
    });
    expect(m.aerobicTE).toBe(5);
    expect(m.anaerobicTE).toBeCloseTo(1.3);
    expect(m.trainingLoad).toBeCloseTo(661.5);
    expect(m.teLabel).toBe("LACTATE_THRESHOLD");
    expect(m.teLabelEs).toBe("Umbral láctico");
    expect(m.gapPaceMinKm).toBe("5:43"); // 1000/2.915 = 343s → 5:43
    expect(m.movingPct).toBeCloseTo((8417 / 8439) * 100);
  });
  it("falls back to elapsed = duration and training_load column", () => {
    const m = extractEffortMetrics({
      training_load: 42,
      moving_duration_seconds: 600,
      duration_seconds: 700,
    });
    expect(m.trainingLoad).toBe(42);
    expect(m.elapsedSec).toBe(700);
    expect(m.movingPct).toBeCloseTo((600 / 700) * 100);
    expect(m.teLabel).toBeNull();
  });
  it("returns all-null effort for an old activity without new data", () => {
    const m = extractEffortMetrics({ duration_seconds: 3600 });
    expect(m.aerobicTE).toBeNull();
    expect(m.trainingLoad).toBeNull();
    expect(m.gapPaceMinKm).toBeNull();
    expect(m.movingPct).toBeNull();
    expect(hasEffortData({ duration_seconds: 3600 })).toBe(false);
  });
  it("hasEffortData is true when any effort metric is present", () => {
    expect(hasEffortData({ aerobic_training_effect: 3 })).toBe(true);
    expect(hasEffortData({ raw_summary: { activityTrainingLoad: 50 } })).toBe(true);
  });
});

describe("parseHrZones", () => {
  it("computes seconds/minutes/pct per zone summing to 100", () => {
    const zones = parseHrZones({
      raw_summary: {
        hrTimeInZone_1: 152,
        hrTimeInZone_2: 213,
        hrTimeInZone_3: 882,
        hrTimeInZone_4: 3010,
        hrTimeInZone_5: 4131,
      },
    });
    expect(zones).not.toBeNull();
    expect(zones).toHaveLength(5);
    const total = 152 + 213 + 882 + 3010 + 4131;
    expect(zones![4].seconds).toBe(4131);
    expect(zones![4].minutes).toBeCloseTo(4131 / 60);
    expect(zones!.reduce((a, z) => a + z.pct, 0)).toBeCloseTo(100);
    expect(zones![0].pct).toBeCloseTo((152 / total) * 100);
  });
  it("treats missing zones as 0", () => {
    const zones = parseHrZones({ raw_summary: { hrTimeInZone_1: 1651 } });
    expect(zones![0].seconds).toBe(1651);
    expect(zones![1].seconds).toBe(0);
    expect(zones![0].pct).toBeCloseTo(100);
  });
  it("returns null when no zone data (old activity)", () => {
    expect(parseHrZones({ duration_seconds: 3600 })).toBeNull();
    expect(parseHrZones({ raw_summary: {} })).toBeNull();
  });
});
