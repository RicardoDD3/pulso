import {
  localDateOf,
  normalizeBodyMeasurement,
  normalizeHealthDay,
  normalizeMetricSamples,
  normalizeProviderScores,
  normalizeSleepSession,
  normalizeWorkout,
} from "@/lib/ow/normalize";
import {
  owActivitySummariesPageSchema,
  owBodySummarySchema,
  owHealthScoresPageSchema,
  owRecoverySummariesPageSchema,
  owSleepSessionsPageSchema,
  owSleepSummariesPageSchema,
  owTimeseriesPageSchema,
  owWorkoutsPageSchema,
} from "@/lib/ow/schemas";

import summariesFixture from "../fixtures/ow/daily-summaries.json";
import sleepFixture from "../fixtures/ow/events-sleep.json";
import workoutsFixture from "../fixtures/ow/events-workout.json";
import scoresFixture from "../fixtures/ow/health-scores.json";
import timeseriesFixture from "../fixtures/ow/timeseries.json";

const USER_ID = "1c9e8d7f-6b5a-4c3d-2e1f-0a9b8c7d6e5f";

const workouts = owWorkoutsPageSchema.parse(workoutsFixture).data;
const sleepSessions = owSleepSessionsPageSchema.parse(sleepFixture).data;
const activity = owActivitySummariesPageSchema.parse(summariesFixture.activity).data[0];
const sleepSummary = owSleepSummariesPageSchema.parse(summariesFixture.sleep).data[0];
const recovery = owRecoverySummariesPageSchema.parse(summariesFixture.recovery).data[0];
const body = owBodySummarySchema.parse(summariesFixture.body);
const timeseries = owTimeseriesPageSchema.parse(timeseriesFixture).data;
const scores = owHealthScoresPageSchema.parse(scoresFixture).data;

describe("normalizeWorkout", () => {
  it("maps a full Garmin run to a canonical workout row", () => {
    const row = normalizeWorkout(USER_ID, workouts[0]);
    expect(row).toMatchObject({
      userId: USER_ID,
      provider: "garmin",
      externalId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      sport: "running",
      name: "Morning Run",
      durationS: 3000,
      distanceM: 10000,
      calories: 512,
      hrAvg: 152,
      hrMax: 176,
      elevationGainM: 84.2,
    });
    expect(row.startAt).toEqual(new Date("2026-08-29T06:30:00Z"));
    // 300 sec/km (5:00/km) → 3.333 m/s: pace→speed conversion happens at ingestion
    expect(row.speedAvgMps).toBeCloseTo(3.3333, 4);
    // OW does not expose these; the FIT enricher fills them later
    expect(row.movingS).toBeNull();
    expect(row.powerAvgW).toBeNull();
    expect(row.raw).toEqual(workouts[0]);
  });

  it("derives duration from start/end when OW omits duration_seconds", () => {
    const row = normalizeWorkout(USER_ID, workouts[1]);
    expect(row.durationS).toBe(45 * 60);
    expect(row.speedAvgMps).toBeNull();
    expect(row.distanceM).toBeNull();
    expect(row.provider).toBe("oura");
  });
});

describe("normalizeSleepSession", () => {
  it("converts seconds to minutes and maps stages", () => {
    const row = normalizeSleepSession(USER_ID, sleepSessions[0]);
    expect(row).toMatchObject({
      userId: USER_ID,
      provider: "garmin",
      externalId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
      totalMin: 420, // 25200 s asleep
      inBedMin: 450, // 27000 s in bed
      efficiency: 93.3,
      deepMin: 90,
      lightMin: 240,
      remMin: 90,
      awakeMin: 30,
      score: null,
      isNap: false,
    });
    expect(row.startAt).toEqual(new Date("2026-08-28T22:45:00Z"));
    expect(row.endAt).toEqual(new Date("2026-08-29T06:15:00Z"));
  });

  it("falls back to duration_seconds for naps without sleep_duration", () => {
    const row = normalizeSleepSession(USER_ID, sleepSessions[1]);
    expect(row.totalMin).toBe(30);
    expect(row.inBedMin).toBe(30);
    expect(row.isNap).toBe(true);
    expect(row.deepMin).toBeNull();
  });
});

describe("normalizeHealthDay", () => {
  it("merges activity, sleep and recovery summaries into one health day", () => {
    const row = normalizeHealthDay(USER_ID, activity, { sleep: sleepSummary, recovery });
    expect(row).toMatchObject({
      userId: USER_ID,
      date: "2026-08-29",
      provider: "garmin",
      steps: 12480,
      floors: 12,
      distanceM: 9315, // 9314.6 rounded
      caloriesTotal: 2450,
      caloriesActive: 643, // 642.5 rounded
      restingHr: 46, // from recovery summary
      hrMin: 44,
      hrMax: 176,
      spo2Avg: 96.5, // from sleep summary
      respirationAvg: 14.2,
      hrvMs: 42.1, // sleep RMSSD wins
    });
    // WHO/Garmin convention: moderate + 2×vigorous
    expect(row.intensityMinutes).toBe(35 + 2 * 25);
    // stress/body battery arrive as timeseries, not summaries
    expect(row.stressAvg).toBeNull();
    expect(row.bodyBatteryHigh).toBeNull();
  });

  it("works with the activity summary alone", () => {
    const row = normalizeHealthDay(USER_ID, activity);
    expect(row.restingHr).toBeNull();
    expect(row.spo2Avg).toBeNull();
    expect(row.steps).toBe(12480);
  });
});

describe("normalizeBodyMeasurement", () => {
  it("maps the body snapshot (already canonical kg/percent)", () => {
    const row = normalizeBodyMeasurement(USER_ID, body, "2026-08-30T00:00:00Z");
    expect(row).toMatchObject({
      userId: USER_ID,
      provider: "garmin",
      weightKg: 72.5,
      bmi: 23.5,
      bodyFatPct: 18.5,
      muscleMassKg: 58.2,
      bodyWaterPct: null, // OW does not expose it
      boneMassKg: null,
    });
    expect(row?.measuredAt).toEqual(new Date("2026-08-30T00:00:00Z"));
  });

  it("returns null when the snapshot has no body-composition data", () => {
    const empty = {
      ...body,
      slow_changing: { weight_kg: null, height_cm: null, body_fat_percent: null, muscle_mass_kg: null, bmi: null, age: 32 },
    };
    expect(normalizeBodyMeasurement(USER_ID, empty, new Date())).toBeNull();
  });
});

describe("normalizeMetricSamples", () => {
  it("maps OW series types to canonical metrics and drops unmapped ones", () => {
    const rows = normalizeMetricSamples(USER_ID, timeseries);
    // fixture has 7 samples; "steps" has no canonical metric_samples slot
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.metric)).toEqual([
      "hr",
      "hr",
      "stress",
      "body_battery",
      "spo2",
      "respiration",
    ]);
    expect(rows[0]).toMatchObject({ userId: USER_ID, value: 148, provider: "garmin" });
    expect(rows[0].recordedAt).toEqual(new Date("2026-08-29T06:31:00Z"));
    // sample without source metadata keeps provenance explicit
    expect(rows[5].provider).toBe("unknown");
  });
});

describe("normalizeProviderScores", () => {
  it("groups scores by (local date, provider), keyed by category", () => {
    const rows = normalizeProviderScores(USER_ID, scores);
    expect(rows).toHaveLength(3);

    const ow = rows.find((r) => r.provider === "ow");
    expect(ow).toMatchObject({ userId: USER_ID, date: "2026-08-29" });
    expect(ow?.scores.sleep).toMatchObject({ value: 84, qualifier: "GOOD" });

    const oura = rows.find((r) => r.provider === "oura");
    expect(oura?.scores.readiness).toMatchObject({ value: 78 });

    // 23:59Z with -06:00 offset is still Aug 29 locally
    const garmin = rows.find((r) => r.provider === "garmin");
    expect(garmin?.date).toBe("2026-08-29");
    expect(garmin?.scores.body_battery).toMatchObject({ value: 92 });
  });
});

describe("localDateOf", () => {
  it("applies the zone offset to pick the local calendar date", () => {
    expect(localDateOf("2026-08-30T03:00:00Z", "-06:00")).toBe("2026-08-29");
    expect(localDateOf("2026-08-30T23:30:00Z", "+02:00")).toBe("2026-08-31");
    expect(localDateOf("2026-08-30T03:00:00Z", null)).toBe("2026-08-30");
    expect(localDateOf("2026-08-30T03:00:00Z")).toBe("2026-08-30");
  });
});
