/**
 * FIT file parser for the enricher (spec doc 03, layer 1). Decodes with the
 * official Garmin FIT SDK and maps session/laps/records/zones into canonical
 * units (meters, seconds, cm, ms, degrees). Defensive by policy: malformed
 * messages are skipped, unknown fields ignored, and input is size-capped
 * before decoding.
 */
import { Decoder, Stream } from "@garmin/fitsdk";
import type { FitMessages, LapMesg, RecordMesg, SessionMesg } from "@garmin/fitsdk";
import { downsampleRoute } from "@/lib/health/downsample";

export const MAX_FIT_BYTES = 25 * 1024 * 1024;

export class FitTooLargeError extends Error {
  constructor() {
    super("fit_too_large");
  }
}

export class FitParseError extends Error {}

export type ParsedFitSession = {
  startTime: Date | null;
  sport: string | null;
  totalDistanceM: number | null;
  totalElapsedS: number | null;
  totalTimerS: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  totalAscentM: number | null;
  totalDescentM: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  trainingLoad: number | null;
  speedAvgMps: number | null;
  speedMaxMps: number | null;
  calories: number | null;
  startLat: number | null;
  startLng: number | null;
};

export type ParsedFitLap = {
  lapIndex: number;
  intensity: string | null;
  startTime: Date | null;
  totalDistanceM: number | null;
  totalTimerS: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  speedAvgMps: number | null;
  avgCadenceSpm: number | null;
  avgPowerW: number | null;
  strideLengthCm: number | null;
  verticalOscillationCm: number | null;
  verticalRatio: number | null;
  groundContactTimeMs: number | null;
  totalAscentM: number | null;
  totalDescentM: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
};

export type ParsedFitRoutePoint = {
  seq: number;
  lat: number;
  lng: number;
  elevationM: number | null;
  recordedAt: Date | null;
  hr: number | null;
};

export type ParsedFitHrZone = { zone: number; seconds: number };

export type ParsedFit = {
  session: ParsedFitSession | null;
  laps: ParsedFitLap[];
  routePoints: ParsedFitRoutePoint[];
  hrZones: ParsedFitHrZone[];
};

/** deg = semicircles × 180 / 2³¹ (FIT stores positions as sint32 semicircles). */
export function semicirclesToDegrees(semicircles: number): number {
  return (semicircles * 180) / 2 ** 31;
}

export function mmToCm(mm: number): number {
  return mm / 10;
}

function asDate(v: unknown): Date | null {
  return v instanceof Date ? v : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asDeg(semicircles: unknown): number | null {
  const n = asNum(semicircles);
  return n === null ? null : semicirclesToDegrees(n);
}

/**
 * FIT reports run/walk cadence as single-leg revolutions per minute; steps/min
 * is double. Cycling/other cadence passes through untouched.
 */
const HALF_CADENCE_SPORTS = new Set(["running", "walking", "hiking"]);

function cadenceSpm(mesg: LapMesg | SessionMesg, sport: string | null): number | null {
  const base = asNum(mesg.avgCadence) ?? asNum((mesg as LapMesg).avgRunningCadence);
  if (base === null) return null;
  const withFraction = base + (asNum(mesg.avgFractionalCadence) ?? 0);
  return sport !== null && HALF_CADENCE_SPORTS.has(sport) ? withFraction * 2 : withFraction;
}

function mapSession(mesg: SessionMesg): ParsedFitSession {
  return {
    startTime: asDate(mesg.startTime),
    sport: typeof mesg.sport === "string" ? mesg.sport : null,
    totalDistanceM: asNum(mesg.totalDistance),
    totalElapsedS: asNum(mesg.totalElapsedTime),
    totalTimerS: asNum(mesg.totalTimerTime),
    hrAvg: asNum(mesg.avgHeartRate),
    hrMax: asNum(mesg.maxHeartRate),
    totalAscentM: asNum(mesg.totalAscent),
    totalDescentM: asNum(mesg.totalDescent),
    aerobicTe: asNum(mesg.totalTrainingEffect),
    anaerobicTe: asNum(mesg.totalAnaerobicTrainingEffect),
    trainingLoad: asNum(mesg.trainingLoadPeak),
    speedAvgMps: asNum(mesg.enhancedAvgSpeed) ?? asNum(mesg.avgSpeed),
    speedMaxMps: asNum(mesg.enhancedMaxSpeed) ?? asNum(mesg.maxSpeed),
    calories: asNum(mesg.totalCalories),
    startLat: asDeg(mesg.startPositionLat),
    startLng: asDeg(mesg.startPositionLong),
  };
}

function mapLap(mesg: LapMesg, index: number, sport: string | null): ParsedFitLap {
  const stanceTime = asNum(mesg.avgStanceTime);
  const stepLengthMm = asNum(mesg.avgStepLength);
  const verticalOscMm = asNum(mesg.avgVerticalOscillation);
  return {
    lapIndex: asNum(mesg.messageIndex) ?? index,
    intensity: typeof mesg.intensity === "string" ? mesg.intensity : null,
    startTime: asDate(mesg.startTime),
    totalDistanceM: asNum(mesg.totalDistance),
    totalTimerS: asNum(mesg.totalTimerTime),
    hrAvg: asNum(mesg.avgHeartRate),
    hrMax: asNum(mesg.maxHeartRate),
    speedAvgMps: asNum(mesg.enhancedAvgSpeed) ?? asNum(mesg.avgSpeed),
    avgCadenceSpm: cadenceSpm(mesg, sport),
    avgPowerW: asNum(mesg.avgPower),
    strideLengthCm: stepLengthMm === null ? null : mmToCm(stepLengthMm),
    verticalOscillationCm: verticalOscMm === null ? null : mmToCm(verticalOscMm),
    verticalRatio: asNum(mesg.avgVerticalRatio),
    groundContactTimeMs: stanceTime,
    totalAscentM: asNum(mesg.totalAscent),
    totalDescentM: asNum(mesg.totalDescent),
    startLat: asDeg(mesg.startPositionLat),
    startLng: asDeg(mesg.startPositionLong),
    endLat: asDeg(mesg.endPositionLat),
    endLng: asDeg(mesg.endPositionLong),
  };
}

function mapRecord(mesg: RecordMesg): Omit<ParsedFitRoutePoint, "seq"> | null {
  const lat = asDeg(mesg.positionLat);
  const lng = asDeg(mesg.positionLong);
  if (lat === null || lng === null) return null;
  return {
    lat,
    lng,
    elevationM: asNum(mesg.enhancedAltitude) ?? asNum(mesg.altitude),
    recordedAt: asDate(mesg.timestamp),
    hr: asNum(mesg.heartRate),
  };
}

/**
 * time_in_hr_zone arrays with a leading "below zone 1" bucket have 6 entries
 * (indexes 0..5 → zones 0..5); 5-entry arrays are zones 1..5 directly. The UI
 * only renders zones 1..5 either way.
 */
function mapHrZones(timeInHrZone: unknown): ParsedFitHrZone[] {
  if (!Array.isArray(timeInHrZone)) return [];
  const offset = timeInHrZone.length >= 6 ? 0 : 1;
  const zones: ParsedFitHrZone[] = [];
  for (let i = 0; i < timeInHrZone.length; i++) {
    const seconds = asNum(timeInHrZone[i]);
    if (seconds === null) continue;
    zones.push({ zone: i + offset, seconds: Math.round(seconds) });
  }
  return zones.some((z) => z.seconds > 0) ? zones : [];
}

/** Pure mapping from decoded FIT messages to ParsedFit — testable without a binary. */
export function mapFitMessages(messages: FitMessages): ParsedFit {
  let session: ParsedFitSession | null = null;
  try {
    const sessionMesg = messages.sessionMesgs?.[0];
    if (sessionMesg) session = mapSession(sessionMesg);
  } catch {
    session = null;
  }
  const sport = session?.sport ?? null;

  const laps: ParsedFitLap[] = [];
  for (const [i, mesg] of (messages.lapMesgs ?? []).entries()) {
    try {
      laps.push(mapLap(mesg, i, sport));
    } catch {
      // skip malformed lap
    }
  }

  const points: Omit<ParsedFitRoutePoint, "seq">[] = [];
  for (const mesg of messages.recordMesgs ?? []) {
    try {
      const point = mapRecord(mesg);
      if (point) points.push(point);
    } catch {
      // skip malformed record
    }
  }
  const routePoints = downsampleRoute(points).map((p, seq) => ({ seq, ...p }));

  let hrZones: ParsedFitHrZone[] = [];
  try {
    const zoneMesgs = messages.timeInZoneMesgs ?? [];
    const sessionZones =
      zoneMesgs.find((m) => m.referenceMesg === "session") ??
      zoneMesgs.find((m) => Array.isArray(m.timeInHrZone));
    hrZones = mapHrZones(sessionZones?.timeInHrZone ?? messages.sessionMesgs?.[0]?.timeInHrZone);
  } catch {
    hrZones = [];
  }

  return { session, laps, routePoints, hrZones };
}

/** Decode a FIT file. Throws FitTooLargeError over 25 MB, FitParseError on non-FIT input. */
export function parseFitFile(bytes: Uint8Array): ParsedFit {
  if (bytes.byteLength > MAX_FIT_BYTES) throw new FitTooLargeError();
  let messages: FitMessages;
  try {
    const stream = Stream.fromByteArray(bytes);
    if (!Decoder.isFIT(stream)) throw new FitParseError("not_a_fit_file");
    ({ messages } = new Decoder(stream).read());
  } catch (err) {
    throw err instanceof FitParseError ? err : new FitParseError("fit_decode_failed");
  }
  return mapFitMessages(messages);
}
