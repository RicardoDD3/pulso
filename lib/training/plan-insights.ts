// plan-insights.ts — Types and pure computation functions for training plan insights

import type { GeneratedPlan, GeneratedWeek, GeneratedDay, Phase } from "./plan-generator-types";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface GarminDailySummary {
  date: string;
  steps: number | null;
  resting_hr: number | null;
  avg_stress: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  spo2: number | null;
  respiration_rate: number | null;
  hrv_weekly_avg: number | null;
  calories_total: number | null;
  hydration_ml: number | null;
  floors_climbed: number | null;
  intensity_minutes: number | null;
}

export interface GarminSleep {
  date: string;
  sleep_seconds: number | null;
  sleep_score: number | null;
}

export interface TrainingActivity {
  activity_id: number;
  date: string;
  activity_type: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  vo2max_value: number | null;
  avg_speed?: number | null;
}

export interface FlaggedBiomarker {
  test_name: string;
  test_name_normalized: string;
  result: string;
  unit: string;
  reference_range: string | null;
  is_flagged: boolean;
  category: string;
  lab_sessions: { sample_date: string };
}

export interface MatchedWorkoutActivity {
  workout: {
    id: number;
    plan_id: number;
    week_number: number;
    date: string;
    workout_type: string;
    title: string;
    target_distance_km: number | null;
    target_pace_range: string | null;
    target_hr_zone: string | null;
    status: string;
    actual_distance_km: number | null;
    actual_pace: number | null;
  };
  activity: TrainingActivity | null;
  /** Todas las carreras Garmin de esa fecha (dobles sesiones), cronológicas. */
  activities?: TrainingActivity[];
}

export interface GarminHealthData {
  todaySummary: GarminDailySummary | null;
  todaySleep: GarminSleep | null;
  dailySummaries: GarminDailySummary[];
  sleepData: GarminSleep[];
  runs: TrainingActivity[];
  flaggedBiomarkers: FlaggedBiomarker[];
  matchedActivities: MatchedWorkoutActivity[];
}

export type ReadinessLevel = "green" | "yellow" | "red";

export interface ReadinessScore {
  bodyBattery: number;
  hrv: number;
  sleepScore: number;
  stress: number;
  composite: number;
  level: ReadinessLevel;
  suggestion: string | null;
}

export interface DayScorecardItem {
  date: string;
  dayLabel: string;
  sessionType: string;
  distanceKm: number;
  isCompleted: boolean;
  isToday: boolean;
}

export interface WeeklyScorecard {
  weekNumber: number;
  phase: Phase;
  totalPlannedKm: number;
  totalActualKm: number;
  completedSessions: number;
  totalSessions: number;
  days: DayScorecardItem[];
}

export interface RaceCountdown {
  daysRemaining: number;
  currentWeek: number;
  totalWeeks: number;
  phase: Phase;
  vo2maxLatest: number | null;
  longestRunKm: number;
  avgKmLast4Weeks: number;
  /** Name of the race the countdown points to (next upcoming race, or the final race). */
  targetRaceName: string | null;
  /** ISO date of the race the countdown points to. */
  targetRaceDate: string;
  /** True when the target is an intermediate race, not the final goal race. */
  isIntermediateRace: boolean;
  /** Total races embedded in the plan (multi-race seasons). */
  racesTotal: number;
  /** Races already run (date in the past). */
  racesCompleted: number;
  /** Races still to run (date today or later). */
  racesRemaining: number;
  /** Names of the remaining races, in date order. */
  remainingRaceNames: string[];
}

export interface PlanRace {
  name: string;
  date: string; // ISO
}

/**
 * Progreso de carreras de la temporada: una carrera cuenta como "completada"
 * cuando su fecha ya pasó (proxy por fecha; no hay tracking por-carrera).
 */
export function raceProgress(
  races: PlanRace[],
  todayISO: string
): { total: number; completed: number; remaining: number; remainingNames: string[] } {
  const remaining = races.filter((r) => r.date >= todayISO);
  return {
    total: races.length,
    completed: races.length - remaining.length,
    remaining: remaining.length,
    remainingNames: remaining.map((r) => r.name),
  };
}

/**
 * Extract every race embedded in the plan weeks. Race days are marked with a
 * `notes` value starting with "DÍA DE CARRERA:". Returns races sorted by date.
 */
export function extractPlanRaces(plan: GeneratedPlan): PlanRace[] {
  const races: PlanRace[] = [];
  for (const week of plan.weeks) {
    for (const day of week.days) {
      const note = day.notes ?? "";
      const marker = note.match(/D[ÍI]A DE CARRERA:\s*(.+)/i);
      if (marker) {
        races.push({ name: marker[1].trim(), date: day.date });
      }
    }
  }
  races.sort((a, b) => a.date.localeCompare(b.date));
  return races;
}

export type AlertSeverity = "info" | "warning" | "danger";
export type AlertType = "missed" | "biomarker" | "hr_trend" | "low_battery" | "compliance";

export interface SmartAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
}

export interface WorkoutComparison {
  planned: {
    distanceKm: number;
    pace: string | null;
    hrZone: string | null;
  };
  actual: {
    distanceKm: number;
    pace: number | null; // min/km
    avgHr: number | null;
  };
  executionScore: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedDate?: string;
}

export interface ProgressRings {
  consistency: number; // 0-100
  volume: number; // 0-100
  longRun: number; // 0-100
  badges: Badge[];
}

export type SemaphoreColor = "green" | "yellow" | "red";

export interface RaceReadiness {
  volumeCompliance: SemaphoreColor;
  volumePct: number;
  longRunMax: number;
  longRunPct: number;
  longRunColor: SemaphoreColor;
  consistencyPct: number;
  consistencyColor: SemaphoreColor;
  healthStatus: SemaphoreColor;
  healthDetails: string;
  overallScore: number;
  overallColor: SemaphoreColor;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

export function getTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function getSemaphoreColor(value: number, greenThreshold: number, yellowThreshold: number): SemaphoreColor {
  if (value >= greenThreshold) return "green";
  if (value >= yellowThreshold) return "yellow";
  return "red";
}

function getActivityDistanceKm(a: TrainingActivity): number {
  const meters = a.distance_meters ?? 0;
  return Number(meters) / 1000;
}

/**
 * Mapa fecha → match SOLO con filas de correr. Los días con fuerza tienen una
 * segunda fila "strength" (status "planned", actual null) con la MISMA fecha;
 * si entrara al mapa pisaría a la carrera completada del día.
 */
function runningMatchByDate(
  matchedActivities: MatchedWorkoutActivity[]
): Map<string, MatchedWorkoutActivity> {
  return new Map(
    matchedActivities
      .filter((m) => m.workout.workout_type !== "strength")
      .map((m) => [m.workout.date, m])
  );
}

/* ------------------------------------------------------------------ */
/* Computation Functions                                              */
/* ------------------------------------------------------------------ */

export function getCurrentWeekIndex(weeks: GeneratedWeek[]): number {
  const today = getTodayISO();
  return weeks.findIndex((w) => {
    if (w.days.length === 0) return false;
    return today >= w.days[0].date && today <= w.days[w.days.length - 1].date;
  });
}

export function getTodaySession(weeks: GeneratedWeek[]): GeneratedDay | null {
  const today = getTodayISO();
  for (const week of weeks) {
    const day = week.days.find((d) => d.date === today);
    if (day) return day;
  }
  return null;
}

export function computeReadinessScore(
  summary: GarminDailySummary | null,
  sleep: GarminSleep | null,
  hrvBaseline?: number
): ReadinessScore {
  if (!summary && !sleep) {
    return { bodyBattery: 0, hrv: 0, sleepScore: 0, stress: 0, composite: 0, level: "yellow", suggestion: null };
  }

  // Body Battery: 0-100 → weight 30%
  const bb = summary?.body_battery_high ?? 50;
  const bbScore = (Math.min(100, Math.max(0, bb)) / 100) * 30;

  // HRV: compare to baseline or use raw (0-100 scale assumed)
  const hrvRaw = summary?.hrv_weekly_avg ?? 50;
  let hrvScore: number;
  if (hrvBaseline && hrvBaseline > 0) {
    const ratio = hrvRaw / hrvBaseline;
    hrvScore = ratio >= 1.1 ? 25 : ratio >= 0.9 ? 18 : ratio >= 0.75 ? 10 : 5;
  } else {
    hrvScore = Math.min(25, (hrvRaw / 80) * 25); // assume 80ms is excellent
  }

  // Sleep score: 0-100 → weight 25%
  const sleepVal = sleep?.sleep_score ?? 50;
  const sleepScoreVal = (Math.min(100, Math.max(0, sleepVal)) / 100) * 25;

  // Stress: 0-100, inverted → weight 20%
  const stressRaw = summary?.avg_stress ?? 30;
  const stressScore = ((100 - Math.min(100, Math.max(0, stressRaw))) / 100) * 20;

  const composite = Math.round(bbScore + hrvScore + sleepScoreVal + stressScore);
  const level: ReadinessLevel = composite >= 70 ? "green" : composite >= 40 ? "yellow" : "red";

  // TODO(i18n): sugerencias, títulos y mensajes de alertas/badges de este módulo
  // son visibles al usuario.
  let suggestion: string | null = null;
  if (level === "red") {
    const reasons: string[] = [];
    if (bb < 30) reasons.push("Body Battery bajo");
    if (sleep && sleep.sleep_score != null && sleep.sleep_score < 50) reasons.push("sueno pobre");
    if (stressRaw > 60) reasons.push("estres alto");
    if (hrvBaseline && hrvRaw < hrvBaseline * 0.75) reasons.push("HRV muy bajo");
    suggestion = `${reasons.join(", ")}. Considera reducir intensidad o descansar.`;
  } else if (level === "yellow") {
    suggestion = "No estas al 100%. Escucha a tu cuerpo durante la sesion.";
  }

  return {
    bodyBattery: bb,
    hrv: hrvRaw,
    sleepScore: sleepVal,
    stress: stressRaw,
    composite,
    level,
    suggestion,
  };
}

export function computeWeeklyScorecard(
  currentWeek: GeneratedWeek | null,
  matchedActivities: MatchedWorkoutActivity[]
): WeeklyScorecard | null {
  if (!currentWeek) return null;

  const today = getTodayISO();
  const matchMap = runningMatchByDate(matchedActivities);

  const nonRestDays = currentWeek.days.filter((d) => d.sessionType !== "rest");
  let totalActualKm = 0;
  let completedSessions = 0;

  const days: DayScorecardItem[] = currentWeek.days.map((day) => {
    const matched = matchMap.get(day.date);
    const isCompleted = matched?.workout.status === "completed";
    if (isCompleted && matched?.workout.actual_distance_km) {
      totalActualKm += matched.workout.actual_distance_km;
    }
    if (isCompleted && day.sessionType !== "rest") completedSessions++;

    return {
      date: day.date,
      dayLabel: day.dayLabel,
      sessionType: day.sessionType,
      distanceKm: day.distanceKm,
      isCompleted,
      isToday: day.date === today,
    };
  });

  return {
    weekNumber: currentWeek.weekNumber,
    phase: currentWeek.phase,
    totalPlannedKm: currentWeek.totalKm,
    totalActualKm: Math.round(totalActualKm * 10) / 10,
    completedSessions,
    totalSessions: nonRestDays.length,
    days,
  };
}

export function computeRaceCountdown(
  plan: GeneratedPlan,
  runs: TrainingActivity[],
  dailySummaries: GarminDailySummary[]
): RaceCountdown {
  const todayISO = getTodayISO();
  const today = new Date(todayISO + "T12:00:00");

  // Multi-race plans embed each race in the plan weeks. Count down to the next
  // upcoming race, not always the final one. Fall back to plan.raceDate.
  const races = extractPlanRaces(plan);
  const nextRace = races.find((r) => r.date >= todayISO);
  const targetRaceDate = nextRace ? nextRace.date : plan.raceDate;
  const targetRaceName = nextRace ? nextRace.name : null;
  const isIntermediateRace = !!nextRace && nextRace.date < plan.raceDate;
  const progress = raceProgress(races, todayISO);

  const raceDay = new Date(targetRaceDate + "T12:00:00");
  const daysRemaining = Math.max(0, Math.round((raceDay.getTime() - today.getTime()) / (86400000)));

  // getCurrentWeekIndex returns -1 both BEFORE the plan starts and AFTER it
  // ends. Distinguish the two: a not-yet-started plan is in its first week, not
  // its final race week.
  const currentWeekIdx = getCurrentWeekIndex(plan.weeks);
  let currentWeek: number;
  let phase: RaceCountdown["phase"];
  if (currentWeekIdx >= 0) {
    currentWeek = currentWeekIdx + 1;
    phase = plan.weeks[currentWeekIdx].phase;
  } else if (plan.weeks.length > 0 && todayISO < plan.weeks[0].days[0]?.date) {
    // Plan has not started yet
    currentWeek = 1;
    phase = plan.weeks[0].phase;
  } else {
    // Plan already finished
    currentWeek = plan.planWeeks;
    phase = "race";
  }

  // VO2max: latest from runs
  const vo2maxValues = runs.filter((r) => r.vo2max_value && r.vo2max_value > 0).map((r) => r.vo2max_value!);
  const vo2maxLatest = vo2maxValues.length > 0 ? vo2maxValues[vo2maxValues.length - 1] : null;

  // Longest run
  const longestRunKm = runs.reduce((max, r) => {
    const km = getActivityDistanceKm(r);
    return km > max ? km : max;
  }, 0);

  // Avg km/week last 4 weeks
  const fourWeeksAgo = new Date(getTodayISO() + "T12:00:00");
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksAgoStr = fourWeeksAgo.toISOString().slice(0, 10);
  const recentRuns = runs.filter((r) => r.date >= fourWeeksAgoStr);
  const totalRecentKm = recentRuns.reduce((sum, r) => sum + getActivityDistanceKm(r), 0);
  const avgKmLast4Weeks = Math.round((totalRecentKm / 4) * 10) / 10;

  return {
    daysRemaining,
    currentWeek,
    totalWeeks: plan.planWeeks,
    phase,
    vo2maxLatest,
    longestRunKm: Math.round(longestRunKm * 10) / 10,
    avgKmLast4Weeks,
    targetRaceName,
    targetRaceDate,
    isIntermediateRace,
    racesTotal: progress.total,
    racesCompleted: progress.completed,
    racesRemaining: progress.remaining,
    remainingRaceNames: progress.remainingNames,
  };
}

export function computeSmartAlerts(
  plan: GeneratedPlan,
  matchedActivities: MatchedWorkoutActivity[],
  dailySummaries: GarminDailySummary[],
  flaggedBiomarkers: FlaggedBiomarker[],
  todaySummary: GarminDailySummary | null,
  todaySession: GeneratedDay | null
): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const today = getTodayISO();
  const matchMap = runningMatchByDate(matchedActivities);

  // 1. Missed sessions streak
  const pastDays = plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date < today && d.sessionType !== "rest")
    .sort((a, b) => b.date.localeCompare(a.date));

  let missedStreak = 0;
  for (const day of pastDays) {
    const matched = matchMap.get(day.date);
    if (!matched || matched.workout.status !== "completed") {
      missedStreak++;
    } else {
      break;
    }
  }
  if (missedStreak >= 3) {
    alerts.push({
      id: "missed-streak",
      type: "missed",
      severity: missedStreak >= 5 ? "danger" : "warning",
      title: `${missedStreak} sesiones seguidas sin completar`,
      body: "Llevas varios dias sin entrenar. Considera ajustar tu plan o hablar con tu coach.",
    });
  }

  // 2. Flagged biomarkers
  for (const bm of flaggedBiomarkers.slice(0, 3)) {
    alerts.push({
      id: `biomarker-${bm.test_name_normalized}`,
      type: "biomarker",
      severity: "info",
      title: `${bm.test_name} fuera de rango`,
      body: `Resultado: ${bm.result} ${bm.unit}${bm.reference_range ? ` (ref: ${bm.reference_range})` : ""}`,
    });
  }

  // 3. Resting HR trend
  if (dailySummaries.length >= 14) {
    const sorted = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
    const recent7 = sorted.slice(-7).filter((s) => s.resting_hr);
    const prev7 = sorted.slice(-14, -7).filter((s) => s.resting_hr);
    if (recent7.length >= 3 && prev7.length >= 3) {
      const avgRecent = recent7.reduce((s, d) => s + (d.resting_hr || 0), 0) / recent7.length;
      const avgPrev = prev7.reduce((s, d) => s + (d.resting_hr || 0), 0) / prev7.length;
      if (avgRecent - avgPrev > 5) {
        alerts.push({
          id: "hr-trend-up",
          type: "hr_trend",
          severity: "warning",
          title: "FC en reposo subiendo",
          body: `Promedio ultimos 7 dias: ${Math.round(avgRecent)} bpm vs ${Math.round(avgPrev)} bpm previos. Posible fatiga acumulada.`,
        });
      }
    }
  }

  // 4. Low body battery before hard session
  if (
    todaySession &&
    ["hiit", "long_run", "back_to_back"].includes(todaySession.sessionType) &&
    todaySummary?.body_battery_high != null &&
    todaySummary.body_battery_high < 50
  ) {
    alerts.push({
      id: "low-battery-today",
      type: "low_battery",
      severity: "danger",
      title: "Body Battery bajo para sesion intensa",
      body: `Tu Body Battery esta en ${todaySummary.body_battery_high}. Hoy toca ${todaySession.sessionType === "long_run" ? "Long Run" : todaySession.sessionType === "back_to_back" ? "B2B" : "HIIT"}. Considera reducir intensidad.`,
    });
  }

  // 5. Weekly compliance
  const currentWeekIdx = getCurrentWeekIndex(plan.weeks);
  if (currentWeekIdx > 0) {
    const lastWeek = plan.weeks[currentWeekIdx - 1];
    const lastWeekNonRest = lastWeek.days.filter((d) => d.sessionType !== "rest");
    const lastWeekCompleted = lastWeekNonRest.filter((d) => {
      const m = matchMap.get(d.date);
      return m && m.workout.status === "completed";
    }).length;
    const pct = lastWeekNonRest.length > 0 ? (lastWeekCompleted / lastWeekNonRest.length) * 100 : 100;
    if (pct < 50) {
      alerts.push({
        id: "compliance-low",
        type: "compliance",
        severity: "warning",
        title: `Semana ${lastWeek.weekNumber}: solo ${Math.round(pct)}% completado`,
        body: `Completaste ${lastWeekCompleted} de ${lastWeekNonRest.length} sesiones la semana pasada.`,
      });
    }
  }

  return alerts;
}

export function computeWorkoutComparison(
  plannedDay: GeneratedDay,
  matched: MatchedWorkoutActivity
): WorkoutComparison | null {
  if (!matched.workout || matched.workout.status !== "completed") return null;

  const actualKm = matched.workout.actual_distance_km ?? 0;
  const actualPace = matched.workout.actual_pace ?? null;
  const actualHr = matched.activity?.avg_hr ?? null;

  // Execution score: 40% distance + 30% pace + 30% zone compliance
  let distScore = 0;
  if (plannedDay.distanceKm > 0 && actualKm > 0) {
    const ratio = actualKm / plannedDay.distanceKm;
    const deviation = Math.abs(ratio - 1);
    distScore = deviation <= 0.1 ? 40 : deviation <= 0.25 ? 30 : deviation <= 0.5 ? 20 : 10;
  } else {
    distScore = 30; // no target, give partial credit
  }

  // Pace and HR scoring is simpler since we may not have targets
  const paceScore = actualPace ? 30 : 15; // partial credit if we have pace data
  const hrScore = actualHr ? 30 : 15;

  const executionScore = Math.min(100, distScore + paceScore + hrScore);

  return {
    planned: {
      distanceKm: plannedDay.distanceKm,
      pace: matched.workout.target_pace_range,
      hrZone: matched.workout.target_hr_zone,
    },
    actual: {
      distanceKm: actualKm,
      pace: actualPace,
      avgHr: actualHr,
    },
    executionScore,
  };
}

export function computeProgressRings(
  plan: GeneratedPlan,
  matchedActivities: MatchedWorkoutActivity[],
  runs: TrainingActivity[]
): ProgressRings {
  const today = getTodayISO();
  const matchMap = runningMatchByDate(matchedActivities);

  // Consistency: % of non-rest sessions completed up to today
  const pastNonRest = plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date <= today && d.sessionType !== "rest");
  const completed = pastNonRest.filter((d) => {
    const m = matchMap.get(d.date);
    return m && m.workout.status === "completed";
  }).length;
  const consistency = pastNonRest.length > 0 ? Math.round((completed / pastNonRest.length) * 100) : 0;

  // Volume: total actual km / total planned km (up to today)
  const pastWeeks = plan.weeks.filter((w) => w.weekStartDate <= today);
  const totalPlannedKm = pastWeeks.reduce((s, w) => s + w.totalKm, 0);
  const totalActualKm = matchedActivities
    .filter((m) => m.workout.status === "completed" && m.workout.date <= today && m.workout.actual_distance_km != null)
    .reduce((s, m) => s + (m.workout.actual_distance_km ?? 0), 0);
  const volume = totalPlannedKm > 0 ? Math.min(100, Math.round((totalActualKm / totalPlannedKm) * 100)) : 0;

  // Long Run: longest run vs race distance
  const longestKm = runs.reduce((max, r) => {
    const km = getActivityDistanceKm(r);
    return km > max ? km : max;
  }, 0);
  const longRun = plan.raceDistanceKm > 0 ? Math.min(100, Math.round((longestKm / plan.raceDistanceKm) * 100)) : 0;

  // Badges
  const badges: Badge[] = [];

  // Badge: Primera semana (first week >80% compliance)
  const week1 = plan.weeks[0];
  if (week1) {
    const w1NonRest = week1.days.filter((d) => d.sessionType !== "rest");
    const w1Done = w1NonRest.filter((d) => {
      const m = matchMap.get(d.date);
      return m && m.workout.status === "completed";
    }).length;
    badges.push({
      id: "primera-semana",
      name: "Primera Semana",
      description: "Completa >80% de la primera semana",
      unlocked: w1NonRest.length > 0 && (w1Done / w1NonRest.length) >= 0.8,
    });
  }

  // Badge: Maratonista (ran >= 42.2km in a single run)
  badges.push({
    id: "maratonista",
    name: "Maratonista",
    description: "Completa un run de 42.2km+",
    unlocked: longestKm >= 42.2,
  });

  // Badge: Consistente (4 consecutive weeks >80%)
  let consecutiveGoodWeeks = 0;
  let maxConsecutive = 0;
  for (const week of plan.weeks) {
    if (week.weekStartDate > today) break;
    const wnr = week.days.filter((d) => d.sessionType !== "rest");
    const wd = wnr.filter((d) => {
      const m = matchMap.get(d.date);
      return m && m.workout.status === "completed";
    }).length;
    if (wnr.length > 0 && (wd / wnr.length) >= 0.8) {
      consecutiveGoodWeeks++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveGoodWeeks);
    } else {
      consecutiveGoodWeeks = 0;
    }
  }
  badges.push({
    id: "consistente",
    name: "Consistente",
    description: "4 semanas consecutivas con >80% adherencia",
    unlocked: maxConsecutive >= 4,
  });

  // Badge: Volumen pico (reached peak weekly km)
  const reachedPeak = plan.weeks.some((week) => {
    if (week.totalKm < plan.peakWeeklyKm * 0.9) return false;
    const weekActualKm = week.days.reduce((sum, d) => {
      const m = matchMap.get(d.date);
      return sum + (m && m.workout.status === "completed" ? (m.workout.actual_distance_km ?? 0) : 0);
    }, 0);
    return weekActualKm >= plan.peakWeeklyKm * 0.9;
  });
  badges.push({
    id: "volumen-pico",
    name: "Volumen Pico",
    description: "Alcanza el 90%+ del pico semanal planeado",
    unlocked: reachedPeak,
  });

  return { consistency, volume, longRun, badges };
}

export function computeRaceReadiness(
  plan: GeneratedPlan,
  matchedActivities: MatchedWorkoutActivity[],
  runs: TrainingActivity[],
  dailySummaries: GarminDailySummary[],
  flaggedBiomarkers: FlaggedBiomarker[]
): RaceReadiness {
  const today = getTodayISO();
  const matchMap = runningMatchByDate(matchedActivities);

  // Volume compliance
  const pastWeeks = plan.weeks.filter((w) => w.weekStartDate <= today);
  const totalPlanned = pastWeeks.reduce((s, w) => s + w.totalKm, 0);
  const totalActual = matchedActivities
    .filter((m) => m.workout.status === "completed" && m.workout.date <= today && m.workout.actual_distance_km != null)
    .reduce((s, m) => s + (m.workout.actual_distance_km ?? 0), 0);
  const volumePct = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const volumeCompliance = getSemaphoreColor(volumePct, 85, 60);

  // Long run max
  const longestKm = runs.reduce((max, r) => Math.max(max, getActivityDistanceKm(r)), 0);
  const longRunMax = Math.round(longestKm * 10) / 10;
  // For ultras, target is ~50% of race. For marathon, ~75%. For half, ~100%
  const targetLongRun = plan.raceDistanceKm <= 25
    ? plan.raceDistanceKm
    : plan.raceDistanceKm <= 45
    ? plan.raceDistanceKm * 0.75
    : plan.raceDistanceKm * 0.5;
  const longRunPct = targetLongRun > 0 ? Math.min(100, Math.round((longRunMax / targetLongRun) * 100)) : 0;
  const longRunColor = getSemaphoreColor(longRunPct, 80, 50);

  // Consistency
  const pastNonRest = plan.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date <= today && d.sessionType !== "rest");
  const completedCount = pastNonRest.filter((d) => {
    const m = matchMap.get(d.date);
    return m && m.workout.status === "completed";
  }).length;
  const consistencyPct = pastNonRest.length > 0 ? Math.round((completedCount / pastNonRest.length) * 100) : 0;
  const consistencyColor = getSemaphoreColor(consistencyPct, 80, 60);

  // Health
  let healthScore = 100;
  const healthReasons: string[] = [];
  if (flaggedBiomarkers.length > 0) {
    healthScore -= flaggedBiomarkers.length * 15;
    healthReasons.push(`${flaggedBiomarkers.length} biomarcadores fuera de rango`);
  }
  // HRV trend
  if (dailySummaries.length >= 14) {
    const sorted = [...dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
    const recent7 = sorted.slice(-7).filter((s) => s.hrv_weekly_avg);
    const prev7 = sorted.slice(-14, -7).filter((s) => s.hrv_weekly_avg);
    if (recent7.length >= 3 && prev7.length >= 3) {
      const avgRecent = recent7.reduce((s, d) => s + (d.hrv_weekly_avg || 0), 0) / recent7.length;
      const avgPrev = prev7.reduce((s, d) => s + (d.hrv_weekly_avg || 0), 0) / prev7.length;
      if (avgRecent < avgPrev * 0.85) {
        healthScore -= 20;
        healthReasons.push("HRV en descenso");
      }
    }
  }
  healthScore = Math.max(0, healthScore);
  const healthStatus = getSemaphoreColor(healthScore, 70, 40);
  const healthDetails = healthReasons.length > 0 ? healthReasons.join(", ") : "Todo bien";

  // Overall: weighted. Cap at 100 — volumePct can exceed 100 (over-completing
  // planned volume) but a readiness *score* is a 0–100 percentage.
  const overall = Math.min(
    100,
    Math.round(volumePct * 0.3 + longRunPct * 0.25 + consistencyPct * 0.25 + healthScore * 0.2)
  );
  const overallColor = getSemaphoreColor(overall, 75, 50);

  return {
    volumeCompliance,
    volumePct,
    longRunMax,
    longRunPct,
    longRunColor,
    consistencyPct,
    consistencyColor,
    healthStatus,
    healthDetails,
    overallScore: overall,
    overallColor,
  };
}

/** Aggregate daily summaries + sleep data by ISO week aligned to plan weeks */
export function computeWeeklyHealthTrends(
  weeks: GeneratedWeek[],
  dailySummaries: GarminDailySummary[],
  sleepData: GarminSleep[]
): { weekNumber: number; totalKm: number; avgHrv: number | null; avgSleepScore: number | null }[] {
  return weeks.map((week) => {
    const startDate = week.weekStartDate;
    const endDate = week.days.length > 0 ? week.days[week.days.length - 1].date : startDate;

    const weekSummaries = dailySummaries.filter((s) => s.date >= startDate && s.date <= endDate);
    const weekSleeps = sleepData.filter((s) => s.date >= startDate && s.date <= endDate);

    const hrvValues = weekSummaries.filter((s) => s.hrv_weekly_avg != null).map((s) => s.hrv_weekly_avg!);
    const sleepScores = weekSleeps.filter((s) => s.sleep_score != null).map((s) => s.sleep_score!);

    return {
      weekNumber: week.weekNumber,
      totalKm: week.totalKm,
      avgHrv: hrvValues.length > 0 ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length) : null,
      avgSleepScore: sleepScores.length > 0 ? Math.round(sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length) : null,
    };
  });
}
