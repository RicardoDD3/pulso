"use client";

/**
 * Contenedor de los paneles de insights portados de el-consejo
 * (UltraPlanView/PlanView). Hace todo el fetching contra las rutas de Pulso,
 * adapta las filas (ver ./adapters) y alimenta las funciones puras de
 * lib/training/plan-insights.ts. La composición replica el orden del original.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeneratedPlan } from "@/lib/training/plan-generator-types";
import {
  computeProgressRings,
  computeRaceCountdown,
  computeRaceReadiness,
  computeReadinessScore,
  computeSmartAlerts,
  computeWeeklyHealthTrends,
  computeWeeklyScorecard,
  computeWorkoutComparison,
  getCurrentWeekIndex,
  getTodayISO,
  getTodaySession,
  type GarminDailySummary,
  type GarminSleep,
  type MatchedWorkoutActivity,
  type TrainingActivity,
} from "@/lib/training/plan-insights";
import type { PlanRow, PlanWorkoutRow } from "@/components/training/types";
import {
  PANEL_CLASS,
  buildPlanWeeks,
  isGeneratedPlan,
  isRunningActivity,
  pickMainSleep,
  rowToTrainingPlanWorkout,
  toDailySummary,
  toMatchedActivity,
  toSleep,
  workoutToActivity,
  type HealthDayJson,
  type MatchJson,
  type SleepJson,
  type WorkoutJson,
} from "./adapters";
import TodayWorkoutCard from "./TodayWorkoutCard";
import SmartAlertsPanel from "./SmartAlertsPanel";
import RaceCountdownBanner from "./RaceCountdownBanner";
import WeeklyScorecardStrip from "./WeeklyScorecardStrip";
import WorkoutComparisonCard from "./WorkoutComparisonCard";
import EnhancedTimeline from "./EnhancedTimeline";
import VolumeChart from "./VolumeChart";
import ReadinessVolumeChart from "./ReadinessVolumeChart";
import ProgressRingsPanel from "./ProgressRingsPanel";
import RaceReadinessPanel from "./RaceReadinessPanel";
import ComplianceChart from "./ComplianceChart";
import PlanCalendar from "./PlanCalendar";
import CalendarView from "./CalendarView";
import TrainingLogView from "./TrainingLogView";

interface InsightsPanelProps {
  planId: string;
  readOnly?: boolean;
}

interface Detail {
  plan: PlanRow;
  workouts: PlanWorkoutRow[];
}

interface HealthState {
  todaySummary: GarminDailySummary | null;
  todaySleep: GarminSleep | null;
  dailySummaries: GarminDailySummary[];
  sleepData: GarminSleep[];
  runs: TrainingActivity[];
  matchedActivities: MatchedWorkoutActivity[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export default function InsightsPanel({ planId, readOnly = false }: InsightsPanelProps) {
  const t = useTranslations("training.insights");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [view, setView] = useState<"log" | "calendar" | "grid">("grid");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!readOnly) {
          // Auto-sync como el original; si falla se renderiza lo que haya.
          try {
            await fetch(`/api/training/plans/${planId}/sync`, { method: "POST" });
          } catch {
            /* offline — seguir */
          }
        }
        const res = await fetch(`/api/training/plans/${planId}`);
        if (!res.ok) throw new Error();
        const planDetail: Detail = await res.json();
        if (cancelled) return;
        setDetail(planDetail);

        const today = getTodayISO();
        const dates = (planDetail.workouts ?? [])
          .map((w) => w.date)
          .filter((d): d is string => Boolean(d))
          .sort();
        const d90 = isoDaysAgo(90);
        const from = dates[0] && dates[0] < d90 ? dates[0] : d90;

        const [dailyRes, trendsRes, workoutsRes, matchedRes] = await Promise.all([
          fetch(`/api/health/daily?date=${today}`)
            .then((r) => r.json())
            .catch(() => ({ day: null, sleep: [] })),
          fetch("/api/health/trends?days=90")
            .then((r) => r.json())
            .catch(() => ({ daily: [], sleep: [] })),
          fetch(`/api/health/workouts?from=${from}&to=${today}&limit=500`)
            .then((r) => r.json())
            .catch(() => ({ workouts: [] })),
          fetch(`/api/training/plans/${planId}/matched-activities`)
            .then((r) => r.json())
            .catch(() => ({ matches: [] })),
        ]);
        if (cancelled) return;

        const todayDay = dailyRes.day as HealthDayJson | null;
        const todaySleepRow = pickMainSleep((dailyRes.sleep ?? []) as SleepJson[]);
        const daily = (trendsRes.daily ?? []) as HealthDayJson[];
        const sleep = ((trendsRes.sleep ?? []) as SleepJson[]).filter((s) => !s.isNap);
        const activities = ((workoutsRes.workouts ?? []) as WorkoutJson[]).map(workoutToActivity);

        setHealth({
          todaySummary: todayDay ? toDailySummary({ ...todayDay, date: todayDay.date ?? today }) : null,
          todaySleep: todaySleepRow ? toSleep({ ...todaySleepRow, date: today }) : null,
          dailySummaries: daily.map(toDailySummary),
          sleepData: sleep.map(toSleep),
          runs: activities.filter(isRunningActivity),
          matchedActivities: ((matchedRes.matches ?? []) as MatchJson[]).map(toMatchedActivity),
        });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, readOnly]);

  const generated: GeneratedPlan | null = useMemo(
    () => (detail && isGeneratedPlan(detail.plan.planJson) ? detail.plan.planJson : null),
    [detail]
  );
  const weeks = useMemo(() => generated?.weeks ?? [], [generated]);

  const currentWeekIdx = useMemo(() => getCurrentWeekIndex(weeks), [weeks]);
  const todaySession = useMemo(() => getTodaySession(weeks), [weeks]);
  const currentWeek = currentWeekIdx >= 0 ? weeks[currentWeekIdx] : null;

  // Insights (mismas llamadas que UltraPlanView; sin biomarcadores — gap de API)
  const insights = useMemo(() => {
    if (!health) return null;
    const hrvValues = health.dailySummaries
      .filter((s) => s.hrv_weekly_avg)
      .map((s) => s.hrv_weekly_avg!);
    const hrvBaseline =
      hrvValues.length > 0 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : undefined;

    const readiness = computeReadinessScore(health.todaySummary, health.todaySleep, hrvBaseline);
    const scorecard = computeWeeklyScorecard(currentWeek, health.matchedActivities);
    if (!generated) return { readiness, scorecard };
    return {
      readiness,
      scorecard,
      countdown: computeRaceCountdown(generated, health.runs, health.dailySummaries),
      rings: computeProgressRings(generated, health.matchedActivities, health.runs),
      raceReadiness: computeRaceReadiness(
        generated,
        health.matchedActivities,
        health.runs,
        health.dailySummaries,
        []
      ),
      weeklyTrends: computeWeeklyHealthTrends(weeks, health.dailySummaries, health.sleepData),
      alerts: computeSmartAlerts(
        generated,
        health.matchedActivities,
        health.dailySummaries,
        [],
        health.todaySummary,
        todaySession
      ),
    };
  }, [health, generated, currentWeek, weeks, todaySession]);

  // Km reales por semana del plan (null en semanas futuras) — como UltraPlanView.
  const actualKmByWeek = useMemo(() => {
    if (!health || weeks.length === 0) return undefined;
    const today = getTodayISO();
    return weeks.map((w) => {
      const first = w.days[0]?.date;
      const last = w.days[w.days.length - 1]?.date;
      if (!first || !last || first > today) return null;
      const km = health.runs
        .filter((r) => r.date >= first && r.date <= last)
        .reduce((s, r) => s + (r.distance_meters || 0) / 1000, 0);
      return Math.round(km * 10) / 10;
    });
  }, [health, weeks]);

  // Comparación plan vs real de la última corrida completada.
  const latestComparison = useMemo(() => {
    if (!health || !generated) return null;
    const today = getTodayISO();
    const completed = health.matchedActivities
      .filter(
        (m) =>
          m.workout.workout_type !== "strength" &&
          m.workout.status === "completed" &&
          m.workout.date <= today
      )
      .sort((a, b) => b.workout.date.localeCompare(a.workout.date));
    for (const match of completed) {
      const day = weeks.flatMap((w) => w.days).find((d) => d.date === match.workout.date);
      if (!day) continue;
      const comparison = computeWorkoutComparison(day, match);
      if (comparison) return { comparison, date: match.workout.date };
    }
    return null;
  }, [health, generated, weeks]);

  // Shapes legacy para ComplianceChart / PlanCalendar (funcionan para todo plan).
  const planWeeks = useMemo(
    () => (detail ? buildPlanWeeks(detail.plan.planJson, detail.workouts) : []),
    [detail]
  );
  const planWorkouts = useMemo(
    () => (detail ? detail.workouts.map(rowToTrainingPlanWorkout) : []),
    [detail]
  );

  if (error) {
    return (
      <div className={`${PANEL_CLASS} rounded-2xl p-6 text-center text-sm text-slate-400`}>
        {t("error")}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <TodayWorkoutCard todaySession={null} readiness={null} loading />
        <div className={`${PANEL_CLASS} rounded-2xl h-40 animate-pulse`} />
      </div>
    );
  }

  const healthLoading = health === null;
  const views: ("log" | "calendar" | "grid")[] = generated
    ? ["log", "calendar", "grid"]
    : ["grid"];

  return (
    <div className="space-y-4">
      {/* --- Hoy + readiness --- */}
      {generated && (
        <TodayWorkoutCard
          todaySession={todaySession}
          readiness={insights?.readiness ?? null}
          loading={healthLoading}
        />
      )}

      {/* --- Alertas inteligentes --- */}
      {insights && "alerts" in insights && insights.alerts && (
        <SmartAlertsPanel alerts={insights.alerts} />
      )}

      {/* --- Countdown a carrera --- */}
      {insights && "countdown" in insights && insights.countdown && (
        <RaceCountdownBanner countdown={insights.countdown} planName={detail.plan.name} />
      )}

      {/* --- Scorecard semanal --- */}
      {insights?.scorecard && <WeeklyScorecardStrip scorecard={insights.scorecard} />}

      {/* --- Última sesión: plan vs real --- */}
      {latestComparison && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            {t("comparison.latest", { date: latestComparison.date })}
          </p>
          <WorkoutComparisonCard comparison={latestComparison.comparison} />
        </div>
      )}

      {/* --- Timeline de fases --- */}
      {generated && <EnhancedTimeline weeks={weeks} currentWeekIdx={currentWeekIdx} />}

      {/* --- Volumen semanal --- */}
      {generated && (
        <VolumeChart
          weeks={weeks}
          peakWeeklyKm={generated.peakWeeklyKm}
          actualKmByWeek={actualKmByWeek}
        />
      )}

      {/* --- Volumen vs recuperación --- */}
      {insights && "weeklyTrends" in insights && insights.weeklyTrends &&
        insights.weeklyTrends.length > 0 && (
          <ReadinessVolumeChart
            weeklyTrends={insights.weeklyTrends}
            currentWeekNumber={currentWeekIdx >= 0 ? currentWeekIdx + 1 : weeks.length}
          />
        )}

      {/* --- Anillos + Race Readiness --- */}
      {insights && "rings" in insights && insights.rings && insights.raceReadiness && insights.countdown && (
        <div className="grid gap-4 md:grid-cols-2">
          <ProgressRingsPanel rings={insights.rings} />
          <RaceReadinessPanel
            readiness={insights.raceReadiness}
            daysToRace={insights.countdown.daysRemaining}
          />
        </div>
      )}

      {/* --- Cumplimiento semanal (todas las variantes de plan) --- */}
      {planWeeks.length > 0 && (
        <ComplianceChart planWorkouts={planWorkouts} weeks={planWeeks} />
      )}

      {/* --- Toggle Log / Calendario / Cuadrícula --- */}
      {planWeeks.length > 0 && (
        <div className="space-y-3">
          {views.length > 1 && (
            <div className="flex items-center gap-2 px-1">
              {views.map((key) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    view === key
                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                      : "text-slate-500 hover:text-slate-300 border border-slate-700"
                  }`}
                >
                  {t(`views.${key}`)}
                </button>
              ))}
            </div>
          )}

          {view === "log" && generated && <TrainingLogView weeks={weeks} />}
          {view === "calendar" && generated && <CalendarView weeks={weeks} />}
          {(view === "grid" || !generated) && (
            <PlanCalendar weeks={planWeeks} planWorkouts={planWorkouts} />
          )}
        </div>
      )}
    </div>
  );
}
