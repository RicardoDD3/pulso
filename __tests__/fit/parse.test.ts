/**
 * @jest-environment node
 *
 * The fixture is a synthetic FIT encoded in-test with the SDK's own Encoder —
 * never a personal file (spec doc 12).
 */
import { Encoder, Profile } from "@garmin/fitsdk";
import type {
  FileIdMesg,
  LapMesg,
  RecordMesg,
  SessionMesg,
  TimeInZoneMesg,
} from "@garmin/fitsdk";
import {
  FitParseError,
  FitTooLargeError,
  MAX_FIT_BYTES,
  mapFitMessages,
  mmToCm,
  parseFitFile,
  semicirclesToDegrees,
} from "@/lib/fit/parse";
import { MAX_ROUTE_POINTS } from "@/lib/health/downsample";

const SEMICIRCLES_PER_DEG = 2 ** 31 / 180;

describe("unit conversions", () => {
  it("converts semicircles to degrees exactly", () => {
    expect(semicirclesToDegrees(0)).toBe(0);
    expect(semicirclesToDegrees(2 ** 31)).toBe(180);
    expect(semicirclesToDegrees(-(2 ** 31))).toBe(-180);
    expect(semicirclesToDegrees(2 ** 30)).toBe(90);
    expect(semicirclesToDegrees(-(2 ** 29))).toBe(-45);
  });

  it("converts mm to cm exactly", () => {
    expect(mmToCm(1052)).toBe(105.2);
    expect(mmToCm(0)).toBe(0);
    expect(mmToCm(87.5)).toBe(8.75);
  });
});

describe("parseFitFile size cap", () => {
  it("throws FitTooLargeError before decoding when over 25 MB", () => {
    expect(() => parseFitFile(new Uint8Array(MAX_FIT_BYTES + 1))).toThrow(FitTooLargeError);
  });

  it("rejects non-FIT bytes with FitParseError", () => {
    expect(() => parseFitFile(new Uint8Array([1, 2, 3, 4]))).toThrow(FitParseError);
    expect(() => parseFitFile(new Uint8Array(64).fill(0xff))).toThrow(FitParseError);
  });
});

/** Synthetic running activity: CDMX start, 3 records/s apart, 2 laps, zones. */
function encodeSyntheticFit(opts: { records?: number } = {}): Uint8Array {
  const start = new Date("2026-08-30T13:00:00Z");
  const lat = 19.4326;
  const lng = -99.1332;
  const encoder = new Encoder();
  const fileId: FileIdMesg = {
    manufacturer: "development",
    product: 1,
    timeCreated: start,
    type: "activity",
  };
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);
  const nRecords = opts.records ?? 3;
  for (let i = 0; i < nRecords; i++) {
    const record: RecordMesg = {
      timestamp: new Date(start.getTime() + i * 1000),
      positionLat: Math.round((lat + i * 1e-4) * SEMICIRCLES_PER_DEG),
      positionLong: Math.round((lng + i * 1e-4) * SEMICIRCLES_PER_DEG),
      enhancedAltitude: 2240 + i,
      heartRate: 140 + (i % 100), // heartRate is a uint8 — stay in range
    };
    encoder.onMesg(Profile.MesgNum.RECORD, record);
  }
  // A record without GPS must be skipped, not break parsing.
  const gpslessRecord: RecordMesg = {
    timestamp: new Date(start.getTime() + nRecords * 1000),
    heartRate: 150,
  };
  encoder.onMesg(Profile.MesgNum.RECORD, gpslessRecord);
  for (let i = 0; i < 2; i++) {
    const lap: LapMesg = {
      messageIndex: i,
      startTime: new Date(start.getTime() + i * 300_000),
      totalTimerTime: 295.5,
      totalDistance: 1000,
      avgHeartRate: 148,
      maxHeartRate: 161,
      avgCadence: 87, // single-leg rpm → 174 steps/min for running
      avgPower: 310,
      avgStepLength: 1052, // mm → 105.2 cm
      avgVerticalOscillation: 87.5, // mm → 8.75 cm
      avgVerticalRatio: 8.3,
      avgStanceTime: 245, // ms
      totalAscent: 12,
      totalDescent: 9,
      startPositionLat: Math.round(lat * SEMICIRCLES_PER_DEG),
      startPositionLong: Math.round(lng * SEMICIRCLES_PER_DEG),
      endPositionLat: Math.round((lat + 0.01) * SEMICIRCLES_PER_DEG),
      endPositionLong: Math.round((lng + 0.01) * SEMICIRCLES_PER_DEG),
      intensity: "active",
    };
    encoder.onMesg(Profile.MesgNum.LAP, lap);
  }
  const session: SessionMesg = {
    startTime: start,
    sport: "running",
    totalElapsedTime: 610.2,
    totalTimerTime: 591,
    totalDistance: 2000,
    avgHeartRate: 149,
    maxHeartRate: 163,
    totalAscent: 24,
    totalDescent: 18,
    totalTrainingEffect: 3.2,
    totalAnaerobicTrainingEffect: 1.4,
    trainingLoadPeak: 82.5,
    enhancedAvgSpeed: 3.38,
    enhancedMaxSpeed: 4.11,
    totalCalories: 180,
    startPositionLat: Math.round(lat * SEMICIRCLES_PER_DEG),
    startPositionLong: Math.round(lng * SEMICIRCLES_PER_DEG),
  };
  encoder.onMesg(Profile.MesgNum.SESSION, session);
  const timeInZone: TimeInZoneMesg = {
    referenceMesg: "session",
    referenceIndex: 0,
    timeInHrZone: [10.4, 60, 200, 250, 60, 20.6],
  };
  encoder.onMesg(Profile.MesgNum.TIME_IN_ZONE, timeInZone);
  return encoder.close();
}

describe("parseFitFile against an encoded fixture", () => {
  const parsed = parseFitFile(encodeSyntheticFit());

  it("extracts the session summary in canonical units", () => {
    const s = parsed.session;
    expect(s).not.toBeNull();
    expect(s?.startTime?.toISOString()).toBe("2026-08-30T13:00:00.000Z");
    expect(s?.sport).toBe("running");
    expect(s?.totalDistanceM).toBe(2000);
    expect(s?.totalElapsedS).toBeCloseTo(610.2, 3);
    expect(s?.totalTimerS).toBeCloseTo(591, 3);
    expect(s?.hrAvg).toBe(149);
    expect(s?.hrMax).toBe(163);
    expect(s?.totalAscentM).toBe(24);
    expect(s?.totalDescentM).toBe(18);
    expect(s?.aerobicTe).toBeCloseTo(3.2, 5);
    expect(s?.anaerobicTe).toBeCloseTo(1.4, 5);
    expect(s?.trainingLoad).toBeCloseTo(82.5, 3);
    expect(s?.speedAvgMps).toBeCloseTo(3.38, 3);
    expect(s?.speedMaxMps).toBeCloseTo(4.11, 3);
    expect(s?.calories).toBe(180);
    expect(s?.startLat).toBeCloseTo(19.4326, 5);
    expect(s?.startLng).toBeCloseTo(-99.1332, 5);
  });

  it("extracts laps with running dynamics converted (mm→cm, half→full cadence)", () => {
    expect(parsed.laps).toHaveLength(2);
    const lap = parsed.laps[0];
    expect(lap.lapIndex).toBe(0);
    expect(parsed.laps[1].lapIndex).toBe(1);
    expect(lap.intensity).toBe("active");
    expect(lap.startTime?.toISOString()).toBe("2026-08-30T13:00:00.000Z");
    expect(lap.totalTimerS).toBeCloseTo(295.5, 3);
    expect(lap.totalDistanceM).toBe(1000);
    expect(lap.hrAvg).toBe(148);
    expect(lap.hrMax).toBe(161);
    expect(lap.avgCadenceSpm).toBe(174);
    expect(lap.avgPowerW).toBe(310);
    expect(lap.strideLengthCm).toBeCloseTo(105.2, 2);
    expect(lap.verticalOscillationCm).toBeCloseTo(8.75, 2);
    expect(lap.verticalRatio).toBeCloseTo(8.3, 2);
    expect(lap.groundContactTimeMs).toBeCloseTo(245, 1);
    expect(lap.totalAscentM).toBe(12);
    expect(lap.totalDescentM).toBe(9);
    expect(lap.startLat).toBeCloseTo(19.4326, 5);
    expect(lap.startLng).toBeCloseTo(-99.1332, 5);
    expect(lap.endLat).toBeCloseTo(19.4426, 5);
    expect(lap.endLng).toBeCloseTo(-99.1232, 5);
  });

  it("extracts route points from records and skips GPS-less ones", () => {
    expect(parsed.routePoints).toHaveLength(3);
    const p = parsed.routePoints[0];
    expect(p.seq).toBe(0);
    expect(p.lat).toBeCloseTo(19.4326, 5);
    expect(p.lng).toBeCloseTo(-99.1332, 5);
    expect(p.elevationM).toBeCloseTo(2240, 1);
    expect(p.hr).toBe(140);
    expect(p.recordedAt?.toISOString()).toBe("2026-08-30T13:00:00.000Z");
    expect(parsed.routePoints[2].lat).toBeCloseTo(19.4328, 5);
  });

  it("extracts hr zones from timeInZoneMesgs (6-entry array keeps zone 0..5)", () => {
    expect(parsed.hrZones).toEqual([
      { zone: 0, seconds: 10 },
      { zone: 1, seconds: 60 },
      { zone: 2, seconds: 200 },
      { zone: 3, seconds: 250 },
      { zone: 4, seconds: 60 },
      { zone: 5, seconds: 21 },
    ]);
  });

  it("downsamples long tracks to ≤2000 points keeping endpoints", () => {
    const long = parseFitFile(encodeSyntheticFit({ records: 2500 }));
    expect(long.routePoints).toHaveLength(MAX_ROUTE_POINTS);
    expect(long.routePoints[0].hr).toBe(140);
    expect(long.routePoints[MAX_ROUTE_POINTS - 1].hr).toBe(140 + (2499 % 100));
    expect(long.routePoints.map((p) => p.seq)).toEqual(
      Array.from({ length: MAX_ROUTE_POINTS }, (_, i) => i),
    );
  });
});

describe("mapFitMessages (pure mapping)", () => {
  it("returns an empty ParsedFit for no messages", () => {
    expect(mapFitMessages({})).toEqual({
      session: null,
      laps: [],
      routePoints: [],
      hrZones: [],
    });
  });

  it("does not double cadence for cycling", () => {
    const out = mapFitMessages({
      sessionMesgs: [{ sport: "cycling" }],
      lapMesgs: [{ avgCadence: 90 }],
    });
    expect(out.laps[0].avgCadenceSpm).toBe(90);
  });

  it("adds fractional cadence before doubling for running", () => {
    const out = mapFitMessages({
      sessionMesgs: [{ sport: "running" }],
      lapMesgs: [{ avgCadence: 87, avgFractionalCadence: 0.5 }],
    });
    expect(out.laps[0].avgCadenceSpm).toBe(175);
  });

  it("falls back to session timeInHrZone with a 5-entry array as zones 1..5", () => {
    const out = mapFitMessages({
      sessionMesgs: [{ timeInHrZone: [60, 120, 180, 60, 30] }],
    });
    expect(out.hrZones.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops all-zero zone arrays", () => {
    const out = mapFitMessages({ sessionMesgs: [{ timeInHrZone: [0, 0, 0, 0, 0] }] });
    expect(out.hrZones).toEqual([]);
  });

  it("skips laps whose fields blow up instead of failing the parse", () => {
    const bad = {
      get startTime(): Date {
        throw new Error("boom");
      },
    };
    const out = mapFitMessages({ lapMesgs: [bad, { totalDistance: 400 }] });
    expect(out.laps).toHaveLength(1);
    expect(out.laps[0].totalDistanceM).toBe(400);
  });
});
