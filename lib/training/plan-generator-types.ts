// plan-generator-types.ts — All types for the deterministic training plan generator

export type Phase = "base" | "build" | "peak" | "taper" | "race";
export type MesoWeek = 1 | 2 | 3 | "rest";
export type SessionType =
  | "z2"
  | "hiit"
  | "long_run"
  | "back_to_back"
  | "strength"
  | "rest";
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type LongRunDay = "saturday" | "sunday";

export interface PlanInputs {
  raceDistanceKm: number; // 50–500
  raceDate: string; // ISO date
  planWeeks: number; // 12–30, default 24
  peakWeeklyKm: number; // 80–300
  currentWeeklyKm: number; // 20–200
  daysPerWeek: 5 | 6 | 7;
  longRunDay: LongRunDay;
  hasBackToBack: boolean;
  experienceLevel: ExperienceLevel;
}

export interface PhaseAllocation {
  baseWeeks: number;
  buildWeeks: number;
  peakWeeks: number;
  taperWeeks: number;
  raceWeek: number;
}

export interface WeekMeta {
  weekNumber: number;
  phase: Phase;
  mesoWeek: MesoWeek;
  isRestWeek: boolean;
}

export interface GeneratedPlan {
  raceDistanceKm: number;
  raceDate: string;
  planWeeks: number;
  peakWeeklyKm: number;
  currentWeeklyKm: number;
  startDate: string;
  weeks: GeneratedWeek[];
  nutritionGuide: NutritionGuide;
  strengthProgram: StrengthProgram;
}

export interface GeneratedWeek {
  weekNumber: number;
  phase: Phase;
  mesoWeek: MesoWeek;
  weekStartDate: string;
  totalKm: number;
  z2Km: number;
  longRunPlusB2bKm: number;
  days: GeneratedDay[];
  /** Volumen semanal objetivo original; totalKm cambia con ediciones, esto no. */
  targetKm?: number;
  /** Hash del último rebalanceo descartado por el usuario (ver rebalance.ts). */
  rebalanceDismissed?: string;
  strengthSessions: number;
  nutritionNote: string;
  specificityNote: string;
  isRestWeek: boolean;
}

/**
 * Sesión de corrida extra en un día (cuadrito adicional al principal).
 * origin "carryover" = km faltantes de un día pasado (recalculados en cada
 * sync); "manual" = creada desde la vista de semana; "planner" = chat Planes;
 * "moved" = sesión arrastrada desde otro día que cayó en un día con otro tipo.
 *
 * OJO: "moved" es el ÚNICO origen que suma a la meta semanal planeada — sus km
 * salieron del distanceKm del día origen, así que si no contara, la meta se
 * caería sola. Los otros tres son redistribución de trabajo ya contado.
 */
export interface ExtraSession {
  id: string;
  sessionType: SessionType;
  distanceKm: number;
  origin: "carryover" | "manual" | "planner" | "moved";
  /** Fecha ISO del día del que viene el faltante (solo carryover). */
  carryoverFrom?: string;
  /** Fecha ISO del día del que se arrastró la sesión (solo moved). */
  movedFrom?: string;
  /**
   * La marca de sesión clave (★) acompaña al TRABAJO, no al día que lo
   * hospeda: si esta sesión vive en un chip (porque cayó como cuadrito nuevo
   * al moverla), la estrella vive aquí, no en `GeneratedDay.isKeySession` del
   * día destino. Así sobrevive a viajes de ida y vuelta entre días (ver
   * placeSession en week-tracks.ts).
   */
  isKeySession?: boolean;
}

export interface GeneratedDay {
  date: string;
  dayOfWeek: number; // 0=Mon, 6=Sun
  dayLabel: string;
  sessionType: SessionType;
  distanceKm: number;
  zone: string;
  notes: string;
  isKeySession: boolean;
  /** Cuadritos de correr adicionales al principal (ver ExtraSession). */
  extraSessions?: ExtraSession[];
  /**
   * Claves "<carryoverFrom>:<sessionType>" de carryovers que el usuario borró
   * en este día; el recálculo del sync no los revive.
   */
  carryoverDismissed?: string[];
  /**
   * Día de fuerza (dimensión independiente de la corrida). Los planes viejos
   * usan sessionType "strength"; normalizeStrength() los convierte a este flag.
   */
  strengthDay?: boolean;
  /**
   * Descanso pedido explícitamente por el usuario (p. ej. "los domingos son
   * descanso" vía chat Planes). removeRestDays() respeta estos días; sin el
   * flag, cualquier rest se convierte a Z2 (política "no hay descansos").
   */
  restLocked?: boolean;
  /**
   * Overrides manuales de asignación de carreras Garmin del día:
   * activity_id (string) → "main" | <extraSession.id> | "none".
   * Solo decisiones humanas; la asignación automática se recalcula siempre
   * (ver lib/training/run-assignment.ts). Refs huérfanos se ignoran/podan.
   */
  runOverrides?: Record<string, string>;
}

export interface NutritionGuide {
  phases: NutritionPhase[];
  targets: {
    totalCalories: string;
    caloriesPerHour: string;
    totalLiquid: string;
    sodiumPerHour: string;
    carbLoadingPreRace: string;
  };
}

export interface NutritionPhase {
  name: string;
  hoursRange: string;
  caloriesPerHour: string;
  strategy: string;
}

export interface StrengthProgram {
  exercises: StrengthProgramExercise[];
  basePhaseFrequency: string;
  buildPeakFrequency: string;
  taperFrequency: string;
}

export interface StrengthProgramExercise {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
}

export const INPUT_CONSTRAINTS = {
  minPlanWeeks: 8,
  maxPlanWeeks: 30,
  minRaceDistanceKm: 21,
  maxRaceDistanceKm: 500,
  minCurrentWeeklyKm: 10,
  maxCurrentWeeklyKm: 200,
  minPeakWeeklyKm: 20,
  maxPeakWeeklyKm: 300,
} as const;

export const SAFETY_CAPS = {
  maxWeekendPercentage: 0.5,
  maxSingleLongRunKm: 65,
  maxWeekendTotalKm: 95,
  maxB2bKm: 38,
} as const;
