// plan-generator.ts — Core deterministic training plan generator algorithm
// All functions are pure: no side effects, no framework dependencies.

import type {
  Phase,
  MesoWeek,
  PlanInputs,
  PhaseAllocation,
  WeekMeta,
  GeneratedPlan,
  GeneratedWeek,
  GeneratedDay,
  SessionType,
} from "./plan-generator-types";
import { INPUT_CONSTRAINTS, SAFETY_CAPS } from "./plan-generator-types";
import {
  DAY_LABELS,
  NUTRITION_NOTES,
  SPECIFICITY_NOTES,
  RACE_NUTRITION_GUIDE,
  STRENGTH_PROGRAM,
} from "./plan-static-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO date string (YYYY-MM-DD) to a Date object at midnight UTC. */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a Date to ISO date string (YYYY-MM-DD). */
function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add days to a Date, returning a new Date. */
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** 0=Mon … 6=Sun (ISO weekday). JS getUTCDay() is 0=Sun. */
function isoWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Round a number to nearest integer. */
function round(n: number): number {
  return Math.round(n);
}

/** Clamp value between min and max. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Linear interpolation from a to b by fraction t in [0,1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Race Category Helpers
// ---------------------------------------------------------------------------

/** Get race category from distance. */
function getRaceCategory(distanceKm: number): "half" | "marathon" | "ultra" {
  if (distanceKm <= 25) return "half";
  if (distanceKm <= 45) return "marathon";
  return "ultra";
}

/** Get distance-specific long run caps. */
function getLongRunCaps(raceDistanceKm: number) {
  const cat = getRaceCategory(raceDistanceKm);
  if (cat === "half") return { base: 16, build: 21, peak: 18, taperRef: 21 };
  if (cat === "marathon") return { base: 26, build: 35, peak: 32, taperRef: 35 };
  return { base: 38, build: 60, peak: 55, taperRef: 60 };
}

/** Get taper configuration based on race distance. */
function getTaperConfig(raceDistanceKm: number) {
  const cat = getRaceCategory(raceDistanceKm);
  if (cat === "half") return { weeks: 2, volumeMults: [0.6, 0.35], lrMults: [0.5, 0.25] };
  if (cat === "marathon") return { weeks: 2, volumeMults: [0.6, 0.35], lrMults: [0.5, 0.25] };
  return { weeks: 3, volumeMults: [0.6, 0.4, 0.2], lrMults: [0.6, 0.38, 0.2] };
}

/** Get peak phase weeks based on race distance. */
function getPeakWeeks(raceDistanceKm: number): number {
  const cat = getRaceCategory(raceDistanceKm);
  if (cat === "half") return 2;
  if (cat === "marathon") return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInputs(inputs: PlanInputs): void {
  const { raceDistanceKm, planWeeks, peakWeeklyKm, currentWeeklyKm } = inputs;
  const c = INPUT_CONSTRAINTS;

  if (planWeeks < c.minPlanWeeks || planWeeks > c.maxPlanWeeks) {
    throw new Error(
      `planWeeks must be between ${c.minPlanWeeks} and ${c.maxPlanWeeks}, got ${planWeeks}`
    );
  }
  if (raceDistanceKm < c.minRaceDistanceKm || raceDistanceKm > c.maxRaceDistanceKm) {
    throw new Error(
      `raceDistanceKm must be between ${c.minRaceDistanceKm} and ${c.maxRaceDistanceKm}, got ${raceDistanceKm}`
    );
  }
  if (currentWeeklyKm < c.minCurrentWeeklyKm || currentWeeklyKm > c.maxCurrentWeeklyKm) {
    throw new Error(
      `currentWeeklyKm must be between ${c.minCurrentWeeklyKm} and ${c.maxCurrentWeeklyKm}, got ${currentWeeklyKm}`
    );
  }
  if (peakWeeklyKm < c.minPeakWeeklyKm || peakWeeklyKm > c.maxPeakWeeklyKm) {
    throw new Error(
      `peakWeeklyKm must be between ${c.minPeakWeeklyKm} and ${c.maxPeakWeeklyKm}, got ${peakWeeklyKm}`
    );
  }
  if (currentWeeklyKm > peakWeeklyKm) {
    throw new Error(
      `currentWeeklyKm (${currentWeeklyKm}) cannot exceed peakWeeklyKm (${peakWeeklyKm})`
    );
  }
}

// ---------------------------------------------------------------------------
// Phase Structure
// ---------------------------------------------------------------------------

/**
 * Calculate how many weeks are allocated to each phase.
 * taper=3, race=1, peak=4 (fixed). Remaining split 50/50 base/build
 * (each rounded down to nearest multiple of 4, overflow goes to base).
 */
export function calculatePhaseStructure(planWeeks: number, raceDistanceKm: number = 100): PhaseAllocation {
  const taperWeeks = getTaperConfig(raceDistanceKm).weeks;
  const raceWeek = 1;
  const peakWeeks = getPeakWeeks(raceDistanceKm);
  const remaining = planWeeks - taperWeeks - raceWeek - peakWeeks;

  let buildWeeks: number;
  let baseWeeks: number;

  if (raceDistanceKm > 45 && remaining >= 8) {
    // Ultra: round to multiple of 4 for clean mesocycles
    const halfRaw = remaining / 2;
    buildWeeks = Math.floor(halfRaw / 4) * 4;
    if (buildWeeks < 4) buildWeeks = 4;
    baseWeeks = remaining - buildWeeks;
    if (baseWeeks < 4) {
      baseWeeks = 4;
      buildWeeks = remaining - baseWeeks;
    }
  } else {
    // Half/marathon: split evenly
    buildWeeks = Math.floor(remaining / 2);
    baseWeeks = remaining - buildWeeks;
  }

  return { baseWeeks, buildWeeks, peakWeeks, taperWeeks, raceWeek };
}

// ---------------------------------------------------------------------------
// Mesocycle
// ---------------------------------------------------------------------------

/**
 * Given a 1-based week index within a phase, return the mesocycle position.
 * Cycle: 1, 2, 3, rest, 1, 2, 3, rest, ...
 */
export function getMesoWeek(weekInPhase: number): MesoWeek {
  const pos = ((weekInPhase - 1) % 4) + 1;
  if (pos === 4) return "rest";
  return pos as 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Build week metas
// ---------------------------------------------------------------------------

/**
 * Produce an array of WeekMeta for every week in the plan.
 * Taper and race do not use mesocycles (mesoWeek is set to 1 for taper, 1 for race).
 */
export function buildWeekMetas(planWeeks: number, raceDistanceKm: number = 100): WeekMeta[] {
  const alloc = calculatePhaseStructure(planWeeks, raceDistanceKm);
  const metas: WeekMeta[] = [];

  let weekNum = 1;

  // Helper to add weeks for a phase with mesocycling
  const addMesoPhase = (phase: Phase, count: number) => {
    for (let i = 1; i <= count; i++) {
      const meso = getMesoWeek(i);
      metas.push({
        weekNumber: weekNum,
        phase,
        mesoWeek: meso,
        isRestWeek: meso === "rest",
      });
      weekNum++;
    }
  };

  // Base, Build, Peak use mesocycles
  addMesoPhase("base", alloc.baseWeeks);
  addMesoPhase("build", alloc.buildWeeks);
  addMesoPhase("peak", alloc.peakWeeks);

  // Taper: 3 weeks, no mesocycle
  for (let i = 0; i < alloc.taperWeeks; i++) {
    metas.push({
      weekNumber: weekNum,
      phase: "taper",
      mesoWeek: 1,
      isRestWeek: false,
    });
    weekNum++;
  }

  // Race: 1 week
  metas.push({
    weekNumber: weekNum,
    phase: "race",
    mesoWeek: 1,
    isRestWeek: false,
  });

  return metas;
}

// ---------------------------------------------------------------------------
// Weekly Volumes
// ---------------------------------------------------------------------------

/**
 * Calculate the weekly km volume for every week.
 *
 * Load weeks (non-rest in base/build/peak) use linear interpolation from
 * currentWeeklyKm to peakWeeklyKm. Within a mesocycle, apply multipliers:
 * meso1=0.92, meso2=0.97, meso3=1.00.
 *
 * Rest weeks = 50% of previous week.
 * Taper = 60% / 40% / 20% of peakWeeklyKm.
 * Race week = raceDistanceKm.
 */
export function calculateWeeklyVolumes(params: {
  metas: WeekMeta[];
  currentWeeklyKm: number;
  peakWeeklyKm: number;
  raceDistanceKm: number;
}): number[] {
  const { metas, currentWeeklyKm, peakWeeklyKm, raceDistanceKm } = params;

  // Collect indices of load weeks (base/build/peak non-rest)
  const loadIndices: number[] = [];
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    if (
      (m.phase === "base" || m.phase === "build" || m.phase === "peak") &&
      !m.isRestWeek
    ) {
      loadIndices.push(i);
    }
  }

  const totalLoadWeeks = loadIndices.length;

  // Map each load week index to its base volume via linear interpolation
  const loadBaseVolumes = new Map<number, number>();
  loadIndices.forEach((idx, order) => {
    const t = totalLoadWeeks > 1 ? order / (totalLoadWeeks - 1) : 1;
    loadBaseVolumes.set(idx, lerp(currentWeeklyKm, peakWeeklyKm, t));
  });

  // Meso multipliers
  const mesoMultiplier = (meso: MesoWeek): number => {
    if (meso === 1) return 0.92;
    if (meso === 2) return 0.97;
    if (meso === 3) return 1.0;
    return 1.0; // rest — won't be used for load weeks
  };

  const volumes: number[] = new Array(metas.length);

  // First pass: load weeks
  for (const idx of loadIndices) {
    const base = loadBaseVolumes.get(idx)!;
    const mult = mesoMultiplier(metas[idx].mesoWeek);
    volumes[idx] = round(base * mult);
  }

  // Second pass: rest, taper, race
  // Track taper position
  let taperIdx = 0;
  const taperMultipliers = getTaperConfig(raceDistanceKm).volumeMults;

  for (let i = 0; i < metas.length; i++) {
    if (volumes[i] !== undefined) continue; // already set (load week)

    const m = metas[i];

    if (m.isRestWeek) {
      // Rest week = 50% of previous week
      const prev = i > 0 ? volumes[i - 1] : currentWeeklyKm;
      volumes[i] = round(prev * 0.5);
    } else if (m.phase === "taper") {
      const mult = taperMultipliers[taperIdx] ?? taperMultipliers[taperMultipliers.length - 1];
      volumes[i] = round(peakWeeklyKm * mult);
      taperIdx++;
    } else if (m.phase === "race") {
      volumes[i] = raceDistanceKm;
    }
  }

  return volumes;
}

// ---------------------------------------------------------------------------
// Long Run
// ---------------------------------------------------------------------------

/**
 * Calculate long run distance for a given week.
 *
 * Linear progression from startLR to phase-specific max across load weeks in
 * that phase. Rest week LR = 40% of previous week's LR. Taper LR = 60%/38%/20%
 * of peak LR (60km). Never > 65km.
 */
export function calculateLongRunKm(params: {
  meta: WeekMeta;
  weekIndex: number;
  metas: WeekMeta[];
  currentWeeklyKm: number;
  prevLongRunKm: number;
  raceDistanceKm: number;
}): number {
  const { meta, weekIndex, metas, currentWeeklyKm, prevLongRunKm, raceDistanceKm } = params;
  const startLR = currentWeeklyKm * 0.28;

  const lrCaps = getLongRunCaps(raceDistanceKm);
  const phaseMaxLR: Record<string, number> = {
    base: lrCaps.base,
    build: lrCaps.build,
    peak: lrCaps.peak,
  };

  if (meta.phase === "race") {
    // Race week: no long run (race itself is the run)
    return 0;
  }

  if (meta.phase === "taper") {
    const taperConfig = getTaperConfig(raceDistanceKm);
    const peakLR = lrCaps.taperRef;
    const taperWeeks = metas.filter((m) => m.phase === "taper");
    const taperPos = taperWeeks.findIndex(
      (tw) => tw.weekNumber === meta.weekNumber
    );
    const mult = taperConfig.lrMults[taperPos] ?? 0.2;
    return Math.min(round(peakLR * mult), SAFETY_CAPS.maxSingleLongRunKm);
  }

  if (meta.isRestWeek) {
    return Math.min(
      round(prevLongRunKm * 0.4),
      SAFETY_CAPS.maxSingleLongRunKm
    );
  }

  // Load week in base/build/peak: linear progression within phase
  const maxLR = phaseMaxLR[meta.phase] ?? 38;

  // Collect load weeks (non-rest) in this phase
  const phaseLoadWeeks = metas
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) => m.phase === meta.phase && !m.isRestWeek
    );

  const posInPhase = phaseLoadWeeks.findIndex(
    ({ m }) => m.weekNumber === meta.weekNumber
  );
  const totalInPhase = phaseLoadWeeks.length;

  // Find the starting LR for this phase
  let phaseStartLR = startLR;
  if (meta.phase !== "base") {
    // Start from the previous phase's last load week LR
    // We approximate by using the max of the previous phase
    const prevPhaseMax: Record<string, number> = {
      build: phaseMaxLR.base,
      peak: phaseMaxLR.build,
    };
    phaseStartLR = prevPhaseMax[meta.phase] ?? startLR;
  }

  const t = totalInPhase > 1 ? posInPhase / (totalInPhase - 1) : 1;
  const lr = lerp(phaseStartLR, maxLR, t);

  return Math.min(round(lr), SAFETY_CAPS.maxSingleLongRunKm);
}

// ---------------------------------------------------------------------------
// B2B (Back to Back)
// ---------------------------------------------------------------------------

/**
 * Calculate B2B distance for a given week.
 *
 * No B2B in rest/taper/race weeks or if hasBackToBack=false.
 * No B2B in the first mesocycle of base (weeks 1-4).
 * B2B ratio by phase and mesoWeek, interpolated. Never > 38km.
 */
export function calculateB2bKm(params: {
  meta: WeekMeta;
  weekIndex: number;
  metas: WeekMeta[];
  longRunKm: number;
  weeklyTotalKm: number;
  hasBackToBack: boolean;
}): number {
  const { meta, longRunKm, weeklyTotalKm, hasBackToBack } = params;

  // No B2B conditions
  if (!hasBackToBack) return 0;
  if (meta.isRestWeek) return 0;
  if (meta.phase === "taper" || meta.phase === "race") return 0;

  // No B2B in first mesocycle of base (weeks 1-4 of base)
  const baseWeeks = params.metas.filter((m) => m.phase === "base");
  if (meta.phase === "base") {
    const posInBase =
      baseWeeks.findIndex((bw) => bw.weekNumber === meta.weekNumber) + 1;
    if (posInBase <= 4) return 0;
  }

  // B2B ratio ranges by phase
  const ratioRanges: Record<string, [number, number]> = {
    base: [0.45, 0.55],
    build: [0.5, 0.55],
    peak: [0.45, 0.5],
  };

  const range = ratioRanges[meta.phase] ?? [0.45, 0.5];

  // Interpolate by mesoWeek: meso1 → low, meso2 → mid, meso3 → high
  let t = 0;
  if (meta.mesoWeek === 1) t = 0;
  else if (meta.mesoWeek === 2) t = 0.5;
  else if (meta.mesoWeek === 3) t = 1;

  const ratio = lerp(range[0], range[1], t);
  let b2bKm = round(longRunKm * ratio);

  // Apply safety caps
  b2bKm = Math.min(b2bKm, SAFETY_CAPS.maxB2bKm);

  // Weekend safety: LR + B2B must not exceed maxWeekendTotalKm
  if (longRunKm + b2bKm > SAFETY_CAPS.maxWeekendTotalKm) {
    b2bKm = SAFETY_CAPS.maxWeekendTotalKm - longRunKm;
  }

  // Weekend must not exceed 50% of weekly total
  if (longRunKm + b2bKm > weeklyTotalKm * SAFETY_CAPS.maxWeekendPercentage) {
    b2bKm = round(
      weeklyTotalKm * SAFETY_CAPS.maxWeekendPercentage - longRunKm
    );
  }

  return Math.max(0, b2bKm);
}

// ---------------------------------------------------------------------------
// Strength & HIIT Sessions
// ---------------------------------------------------------------------------

/**
 * Number of strength sessions for a week.
 * base=2, build/peak=1, rest=1, taper/race=0
 */
export function getStrengthSessions(phase: Phase, isRestWeek: boolean): number {
  if (phase === "taper" || phase === "race") return 0;
  if (isRestWeek) return 1;
  if (phase === "base") return 2;
  return 1; // build, peak
}

/**
 * Number of HIIT sessions for a week.
 * base=2, build/peak=1, rest=1, taper/race=0
 */
export function getHiitSessions(phase: Phase, isRestWeek: boolean): number {
  if (phase === "taper" || phase === "race") return 0;
  if (isRestWeek) return 1;
  if (phase === "base") return 2;
  return 1; // build, peak
}

// ---------------------------------------------------------------------------
// Daily Distribution
// ---------------------------------------------------------------------------

/**
 * Distribute the weekly km across individual days.
 *
 * Default 6-day layout (longRunDay=saturday):
 *   Mon: Z2  |  Tue: HIIT  |  Wed: Z2  |  Thu: HIIT/Strength  |  Fri: Z2  |  Sat: LR  |  Sun: B2B/Rest
 *
 * If longRunDay=sunday, Sat and Sun swap roles.
 * If daysPerWeek=5, Friday is rest.
 * If daysPerWeek=7, all days have runs.
 *
 * HIIT km = 15% of remaining after weekend.
 * Z2 = rest divided evenly across Z2 days.
 */
export function distributeDailyKm(params: {
  weeklyTotalKm: number;
  longRunKm: number;
  b2bKm: number;
  phase: Phase;
  isRestWeek: boolean;
  hiitSessions: number;
  strengthSessions: number;
  daysPerWeek: 5 | 6 | 7;
  longRunDay: "saturday" | "sunday";
  weekStartDate: Date;
}): GeneratedDay[] {
  const {
    weeklyTotalKm,
    longRunKm,
    b2bKm,
    phase,
    isRestWeek,
    hiitSessions,
    strengthSessions,
    daysPerWeek,
    longRunDay,
    weekStartDate,
  } = params;

  const days: GeneratedDay[] = [];

  // Day indices: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  const lrDayIdx = longRunDay === "saturday" ? 5 : 6;
  const b2bDayIdx = longRunDay === "saturday" ? 6 : 5;

  // Remaining km after weekend sessions
  const weekendKm = longRunKm + b2bKm;
  const midweekKm = Math.max(0, weeklyTotalKm - weekendKm);

  // HIIT km: 15% of midweek km per session
  const hiitKmPerSession =
    hiitSessions > 0 ? round(midweekKm * 0.15) : 0;
  const totalHiitKm = hiitKmPerSession * hiitSessions;

  // Z2 km: remaining midweek after HIIT
  const z2Total = Math.max(0, midweekKm - totalHiitKm);

  // Determine which days are rest
  const restDays = new Set<number>();
  if (daysPerWeek <= 6) restDays.add(b2bKm > 0 ? -1 : b2bDayIdx); // only rest if no B2B
  if (daysPerWeek === 5) restDays.add(4); // Friday is rest

  // Build day assignments
  type DayAssignment = {
    sessionType: SessionType;
    km: number;
    zone: string;
    notes: string;
    isKey: boolean;
  };

  const assignments: DayAssignment[] = [];
  let hiitAssigned = 0;

  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStartDate, d);

    if (d === lrDayIdx) {
      // Long run day
      assignments.push({
        sessionType: longRunKm > 0 ? "long_run" : "rest",
        km: longRunKm,
        zone: "Z2",
        notes: longRunKm > 0 ? "Long run" : "Descanso",
        isKey: longRunKm > 0,
      });
      continue;
    }

    if (d === b2bDayIdx) {
      // B2B or rest
      if (b2bKm > 0) {
        assignments.push({
          sessionType: "back_to_back",
          km: b2bKm,
          zone: "Z2",
          notes: "Back-to-back: corre con fatiga del día anterior",
          isKey: true,
        });
      } else {
        assignments.push({
          sessionType: "rest",
          km: 0,
          zone: "",
          notes: "Descanso",
          isKey: false,
        });
      }
      continue;
    }

    // Friday rest if 5 days/week
    if (d === 4 && daysPerWeek === 5) {
      assignments.push({
        sessionType: "rest",
        km: 0,
        zone: "",
        notes: "Descanso",
        isKey: false,
      });
      continue;
    }

    // Tuesday: HIIT (if available)
    if (d === 1 && hiitSessions > 0 && hiitAssigned < hiitSessions) {
      hiitAssigned++;
      assignments.push({
        sessionType: "hiit",
        km: hiitKmPerSession,
        zone: "Z4-Z5",
        notes: "Intervalos / HIIT",
        isKey: true,
      });
      continue;
    }

    // Thursday: 2nd HIIT in base, strength otherwise
    if (d === 3) {
      if (
        hiitSessions >= 2 &&
        hiitAssigned < hiitSessions
      ) {
        hiitAssigned++;
        assignments.push({
          sessionType: "hiit",
          km: hiitKmPerSession,
          zone: "Z4-Z5",
          notes: "Intervalos / HIIT #2",
          isKey: true,
        });
        continue;
      } else if (strengthSessions > 0) {
        assignments.push({
          sessionType: "strength",
          km: 0,
          zone: "",
          notes: "Fuerza",
          isKey: false,
        });
        continue;
      }
    }

    // Default: Z2
    assignments.push({
      sessionType: "z2",
      km: 0, // placeholder, will distribute below
      zone: "Z2",
      notes: "Z2 fácil",
      isKey: false,
    });
  }

  // Distribute Z2 km evenly across Z2 days
  const z2Indices = assignments
    .map((a, i) => (a.sessionType === "z2" ? i : -1))
    .filter((i) => i >= 0);

  const z2Count = z2Indices.length;
  if (z2Count > 0) {
    const z2PerDay = round(z2Total / z2Count);
    // Distribute and handle rounding
    let z2Remaining = z2Total;
    for (let i = 0; i < z2Indices.length; i++) {
      if (i === z2Indices.length - 1) {
        // Last Z2 day gets whatever is left
        assignments[z2Indices[i]].km = Math.max(0, z2Remaining);
      } else {
        const km = Math.min(z2PerDay, z2Remaining);
        assignments[z2Indices[i]].km = km;
        z2Remaining -= km;
      }
    }
  }

  // Race week special handling. calculateLongRunKm returns 0 for phase "race",
  // so there is NO "long_run" day to relabel — the whole race distance would
  // otherwise leak onto the weekday Z2 runs. Put the race itself on the race day
  // (the long-run slot) and turn the weekday runs into light shakeouts.
  if (phase === "race") {
    assignments[lrDayIdx] = {
      sessionType: "long_run",
      km: weeklyTotalKm, // === raceDistanceKm for the race week
      zone: "Z2",
      notes: "DÍA DE CARRERA",
      isKey: true,
    };
    for (const i of z2Indices) {
      assignments[i].km = 0; // shakeout; keeps the week total === race distance
    }
  }

  // Convert to GeneratedDay
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStartDate, d);
    const a = assignments[d];
    days.push({
      date: formatDate(date),
      dayOfWeek: d,
      dayLabel: DAY_LABELS[d],
      sessionType: a.sessionType,
      distanceKm: a.km,
      zone: a.zone,
      notes: a.notes,
      isKeySession: a.isKey,
    });
  }

  return days;
}

// ---------------------------------------------------------------------------
// Nutrition & Specificity Notes
// ---------------------------------------------------------------------------

function getNutritionNote(phase: Phase, weekInPhase: number): string {
  const notes = NUTRITION_NOTES[phase];
  if (!notes || notes.length === 0) return "";
  const idx = (weekInPhase - 1) % notes.length;
  return notes[idx];
}

function getSpecificityNote(phase: Phase, weekInPhase: number): string {
  const notes = SPECIFICITY_NOTES[phase];
  if (!notes || notes.length === 0) return "";
  const idx = (weekInPhase - 1) % notes.length;
  return notes[idx];
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * Generate a complete, deterministic training plan from the given inputs.
 * Pure function: same inputs always produce same output.
 */
export function generateTrainingPlan(inputs: PlanInputs): GeneratedPlan {
  validateInputs(inputs);

  const {
    raceDistanceKm,
    raceDate,
    planWeeks,
    peakWeeklyKm,
    currentWeeklyKm,
    daysPerWeek,
    longRunDay,
    hasBackToBack,
  } = inputs;

  // Calculate start date: raceDate - (planWeeks * 7), adjusted to Monday
  const raceDateObj = parseDate(raceDate);
  let startDateObj = addDays(raceDateObj, -(planWeeks * 7));
  // Adjust to Monday (isoWeekday 0)
  const dayOfWeek = isoWeekday(startDateObj);
  if (dayOfWeek !== 0) {
    startDateObj = addDays(startDateObj, -dayOfWeek);
  }

  const startDate = formatDate(startDateObj);

  // Auto-disable B2B for half marathons
  const effectiveB2B = getRaceCategory(raceDistanceKm) === "half" ? false : hasBackToBack;

  // Build week metas
  const metas = buildWeekMetas(planWeeks, raceDistanceKm);

  // Calculate weekly volumes
  const volumes = calculateWeeklyVolumes({
    metas,
    currentWeeklyKm,
    peakWeeklyKm,
    raceDistanceKm,
  });

  // Track long run for rest week calculation
  let prevLongRunKm = currentWeeklyKm * 0.28;

  // Track week-in-phase counters for nutrition/specificity notes
  const phaseWeekCounters: Record<string, number> = {};

  // Generate each week
  const weeks: GeneratedWeek[] = metas.map((meta, idx) => {
    const weekStartDate = addDays(startDateObj, idx * 7);
    const weeklyTotalKm = volumes[idx];

    // Track week in phase
    if (!phaseWeekCounters[meta.phase]) phaseWeekCounters[meta.phase] = 0;
    phaseWeekCounters[meta.phase]++;
    const weekInPhase = phaseWeekCounters[meta.phase];

    // Long run
    const longRunKm = calculateLongRunKm({
      meta,
      weekIndex: idx,
      metas,
      currentWeeklyKm,
      prevLongRunKm,
      raceDistanceKm,
    });

    // B2B
    const b2bKm = calculateB2bKm({
      meta,
      weekIndex: idx,
      metas,
      longRunKm,
      weeklyTotalKm,
      hasBackToBack: effectiveB2B,
    });

    // Sessions
    const strengthSessions = getStrengthSessions(meta.phase, meta.isRestWeek);
    const hiitSessions = getHiitSessions(meta.phase, meta.isRestWeek);

    // Daily distribution
    const days = distributeDailyKm({
      weeklyTotalKm,
      longRunKm,
      b2bKm,
      phase: meta.phase,
      isRestWeek: meta.isRestWeek,
      hiitSessions,
      strengthSessions,
      daysPerWeek,
      longRunDay,
      weekStartDate,
    });

    // Update prevLongRunKm for next iteration
    if (!meta.isRestWeek && longRunKm > 0) {
      prevLongRunKm = longRunKm;
    }

    // Calculate z2Km from days
    const z2Km = days
      .filter((d) => d.sessionType === "z2")
      .reduce((sum, d) => sum + d.distanceKm, 0);

    return {
      weekNumber: meta.weekNumber,
      phase: meta.phase,
      mesoWeek: meta.mesoWeek,
      weekStartDate: formatDate(weekStartDate),
      totalKm: weeklyTotalKm,
      z2Km,
      longRunPlusB2bKm: longRunKm + b2bKm,
      days,
      strengthSessions,
      nutritionNote: getNutritionNote(meta.phase, weekInPhase),
      specificityNote: getSpecificityNote(meta.phase, weekInPhase),
      isRestWeek: meta.isRestWeek,
    };
  });

  return {
    raceDistanceKm,
    raceDate,
    planWeeks,
    peakWeeklyKm,
    currentWeeklyKm,
    startDate,
    weeks,
    nutritionGuide: RACE_NUTRITION_GUIDE,
    strengthProgram: STRENGTH_PROGRAM,
  };
}
