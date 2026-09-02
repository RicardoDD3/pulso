"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { GeneratedWeek, GeneratedDay, Phase } from "@/lib/training/plan-generator-types";
import { PANEL_CLASS, type WorkoutJson } from "./adapters";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface TrainingLogViewProps {
  weeks: GeneratedWeek[];
  onEditDay?: (weekIndex: number, dayIndex: number, day: GeneratedDay) => void;
}

interface ExerciseLog {
  date: string;
  exercise: string;
  reps: number;
}

/** Definición camelCase como la sirve /api/exercises/definitions. */
interface ExerciseDefJson {
  exerciseKey: string;
  label: string;
  type: "bodyweight" | "weighted";
  weeklyGoal?: number | null;
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_EXERCISE_TARGETS: Record<string, number> = {
  sentadillas: 1000,
  lagartijas: 500,
  barras: 250,
  planks: 50,
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const DEFAULT_WEEKLY_TARGET = 100;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function pctColor(pct: number): string {
  if (pct >= 80) return "text-green-400";
  if (pct >= 50) return "text-amber-400";
  return "text-red-400";
}

function pctStr(actual: number, target: number): string {
  if (target <= 0) return "";
  return ((actual / target) * 100).toFixed(1) + "%";
}

function getDayDates(week: GeneratedWeek): string[] {
  // Return the 7 day dates for this week from the days array
  return week.days.map((d) => d.date);
}

function getCurrentWeekIndex(weeks: GeneratedWeek[]): number {
  const today = new Date().toISOString().split("T")[0];
  return weeks.findIndex((w) => {
    if (w.days.length === 0) return false;
    const firstDate = w.days[0].date;
    const lastDate = w.days[w.days.length - 1].date;
    return today >= firstDate && today <= lastDate;
  });
}

/* ------------------------------------------------------------------ */
/* Data processing                                                    */
/* ------------------------------------------------------------------ */

interface DayData {
  runKm: number;
  runDuration: number;
  walkKm: number;
  exercises: Record<string, number>;
}

function buildLookups(
  activities: WorkoutJson[],
  exercises: ExerciseLog[]
): Map<string, DayData> {
  const map = new Map<string, DayData>();

  function ensure(date: string): DayData {
    if (!map.has(date)) {
      map.set(date, { runKm: 0, runDuration: 0, walkKm: 0, exercises: {} });
    }
    return map.get(date)!;
  }

  for (const a of activities) {
    const date = a.startAt?.split("T")[0] || "";
    if (!date) continue;
    const d = ensure(date);
    const km = (a.distanceM || 0) / 1000;
    const dur = a.durationS || 0;
    const type = (a.sport || "").toLowerCase();

    if (type.includes("running")) {
      d.runKm += km;
      d.runDuration += dur;
    } else if (type.includes("walking")) {
      d.walkKm += km;
    }
  }

  for (const e of exercises) {
    if (!e.date) continue;
    const d = ensure(e.date);
    d.exercises[e.exercise] = (d.exercises[e.exercise] || 0) + e.reps;
  }

  return map;
}

interface WeekSummary {
  weekNumber: number;
  phase: Phase;
  weekStartDate: string;
  plannedKm: number;
  days: string[];
  walking: number[];
  run: number[];
  runDuration: number[];
  exercises: Record<string, number[]>;
  totals: {
    walkKm: number;
    runKm: number;
    runDuration: number;
    exercises: Record<string, number>;
  };
}

function computeWeekSummaries(
  weeks: GeneratedWeek[],
  lookup: Map<string, DayData>,
  exerciseKeys: string[]
): WeekSummary[] {
  return weeks.map((week) => {
    const days = getDayDates(week);
    const walking: number[] = [];
    const run: number[] = [];
    const runDuration: number[] = [];
    const exercises: Record<string, number[]> = {};
    for (const key of exerciseKeys) {
      exercises[key] = [];
    }

    let totWalk = 0;
    let totRun = 0;
    let totRunDur = 0;
    const totExercises: Record<string, number> = {};
    for (const key of exerciseKeys) {
      totExercises[key] = 0;
    }

    for (const date of days) {
      const d = lookup.get(date);
      const wk = d?.walkKm || 0;
      const rk = d?.runKm || 0;
      const rd = d?.runDuration || 0;

      walking.push(wk);
      run.push(rk);
      runDuration.push(rd);

      totWalk += wk;
      totRun += rk;
      totRunDur += rd;

      for (const ex of exerciseKeys) {
        const val = d?.exercises[ex] || 0;
        exercises[ex].push(val);
        totExercises[ex] += val;
      }
    }

    return {
      weekNumber: week.weekNumber,
      phase: week.phase,
      weekStartDate: week.weekStartDate,
      plannedKm: week.totalKm,
      days,
      walking,
      run,
      runDuration,
      exercises,
      totals: {
        walkKm: totWalk,
        runKm: totRun,
        runDuration: totRunDur,
        exercises: totExercises,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function TrainingLogView({ weeks, onEditDay }: TrainingLogViewProps) {
  const t = useTranslations("training.insights.log");
  const tDays = useTranslations("training.insights.days");
  const locale = useLocale();
  const [activities, setActivities] = useState<WorkoutJson[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [definitions, setDefinitions] = useState<ExerciseDefJson[]>([]);
  const [loading, setLoading] = useState(true);

  function formatWeekDate(iso: string): string {
    const d = new Date(iso + "T12:00:00");
    const day = d.getDate().toString().padStart(2, "0");
    const month = d.toLocaleDateString(locale === "es" ? "es-MX" : locale, { month: "short" });
    // Capitalize first letter
    return `${day}-${month.charAt(0).toUpperCase()}${month.slice(1)}`;
  }

  // Fetch exercise definitions on mount
  useEffect(() => {
    fetch("/api/exercises/definitions")
      .then((r) => r.json())
      .then((json) => setDefinitions(json.definitions || []))
      .catch(() => { /* ignore */ });
  }, []);

  // Derive dynamic values from definitions
  const bodyweightDefs = useMemo(
    () => definitions.filter((d) => d.type === "bodyweight"),
    [definitions]
  );

  const exerciseKeys = useMemo(
    () => bodyweightDefs.map((d) => d.exerciseKey),
    [bodyweightDefs]
  );

  const rowTypes = useMemo(
    () => ["walking", "run", ...exerciseKeys],
    [exerciseKeys]
  );

  const exerciseLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of bodyweightDefs) {
      map[d.exerciseKey] = d.label;
    }
    return map;
  }, [bodyweightDefs]);

  const exerciseTargets = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of bodyweightDefs) {
      map[d.exerciseKey] =
        d.weeklyGoal ?? DEFAULT_EXERCISE_TARGETS[d.exerciseKey] ?? DEFAULT_WEEKLY_TARGET;
    }
    return map;
  }, [bodyweightDefs]);

  // Compute date range from weeks
  const dateRange = useMemo(() => {
    if (weeks.length === 0) return { from: "", to: "" };
    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    const from = firstWeek.days[0]?.date || firstWeek.weekStartDate;
    const to = lastWeek.days[lastWeek.days.length - 1]?.date || lastWeek.weekStartDate;
    return { from, to };
  }, [weeks]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;

    async function fetchData() {
      setLoading(true);
      try {
        const [actRes, exRes] = await Promise.all([
          fetch(`/api/health/workouts?from=${dateRange.from}&to=${dateRange.to}&limit=500`)
            .then((r) => r.json())
            .catch(() => ({ workouts: [] })),
          fetch(`/api/exercises/logs?from=${dateRange.from}&to=${dateRange.to}`)
            .then((r) => r.json())
            .catch(() => ({ logs: [] })),
        ]);
        setActivities(actRes.workouts || []);
        setExerciseLogs(
          ((exRes.logs || []) as { date: string; exerciseKey: string; reps: number }[]).map(
            (l) => ({ date: l.date, exercise: l.exerciseKey, reps: l.reps })
          )
        );
      } catch (e) {
        console.error("[TrainingLogView] fetch error:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [dateRange.from, dateRange.to]);

  const lookup = useMemo(
    () => buildLookups(activities, exerciseLogs),
    [activities, exerciseLogs]
  );

  const weekSummaries = useMemo(
    () => computeWeekSummaries(weeks, lookup, exerciseKeys),
    [weeks, lookup, exerciseKeys]
  );

  const currentWeekIdx = useMemo(() => getCurrentWeekIndex(weeks), [weeks]);
  const currentWeekRef = useRef<HTMLTableRowElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current week after data loads
  useEffect(() => {
    if (!loading && currentWeekRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const row = currentWeekRef.current;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const offset = rowRect.top - containerRect.top + container.scrollTop - 60;
      container.scrollTo({ top: offset, behavior: "smooth" });
    }
  }, [loading, currentWeekIdx]);

  // Grand totals
  const grandTotals = useMemo(() => {
    let walkKm = 0;
    let runKm = 0;
    let runDuration = 0;
    let plannedKm = 0;
    const exercises: Record<string, number> = {};
    for (const key of exerciseKeys) {
      exercises[key] = 0;
    }

    for (const ws of weekSummaries) {
      walkKm += ws.totals.walkKm;
      runKm += ws.totals.runKm;
      runDuration += ws.totals.runDuration;
      plannedKm += ws.plannedKm;
      for (const ex of exerciseKeys) {
        exercises[ex] += ws.totals.exercises[ex] || 0;
      }
    }

    const totalExTargets: Record<string, number> = {};
    for (const ex of exerciseKeys) {
      totalExTargets[ex] = (exerciseTargets[ex] || DEFAULT_WEEKLY_TARGET) * weekSummaries.length;
    }

    return { walkKm, runKm, runDuration, plannedKm, exercises, totalExTargets };
  }, [weekSummaries, exerciseKeys, exerciseTargets]);

  if (loading) {
    return (
      <div className={`${PANEL_CLASS} rounded-2xl p-8 text-center text-slate-500`}>
        {t("loading")}
      </div>
    );
  }

  // Sticky column widths
  const STICKY_W = "left-0 w-[58px] min-w-[58px] max-w-[58px]";
  const STICKY_W2 = "left-[58px] w-[28px] min-w-[28px] max-w-[28px]";
  const STICKY_W3 = "left-[86px] w-[72px] min-w-[72px] max-w-[72px]";
  const stickyBase = "sticky z-10";
  const stickyBg = "bg-[#0f1219]"; // match dark bg so sticky cols aren't transparent
  const stickyBgAlt = "bg-[#111520]";
  const stickyBgHeader = "bg-[#1a1f2e]";
  const stickyShadow = "after:absolute after:top-0 after:right-[-6px] after:bottom-0 after:w-[6px] after:bg-gradient-to-r after:from-black/20 after:to-transparent after:pointer-events-none";

  return (
    <div className={`${PANEL_CLASS} rounded-2xl overflow-hidden`}>
      <div ref={scrollContainerRef} className="overflow-x-auto overflow-y-auto max-h-[75vh] relative">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
              <th className={`${stickyBase} ${STICKY_W} ${stickyBgHeader} text-left py-2 px-1.5 border-b border-slate-700/50`}>{t("date")}</th>
              <th className={`${stickyBase} ${STICKY_W2} ${stickyBgHeader} text-center py-2 px-0.5 border-b border-slate-700/50`}>{t("weekNo")}</th>
              <th className={`${stickyBase} ${STICKY_W3} ${stickyBgHeader} text-left py-2 px-1.5 border-b border-slate-700/50 ${stickyShadow}`}>{t("type")}</th>
              {DAY_KEYS.map((d) => (
                <th key={d} className={`${stickyBgHeader} text-right py-2 px-1.5 border-b border-slate-700/50 min-w-[44px]`}>
                  {tDays(d)}
                </th>
              ))}
              <th className={`${stickyBgHeader} text-right py-2 px-1.5 border-b border-slate-700/50 min-w-[62px]`}>{t("total")}</th>
              <th className={`${stickyBgHeader} text-right py-2 px-1.5 border-b border-slate-700/50 min-w-[50px]`}>{t("plan")}</th>
              <th className={`${stickyBgHeader} text-right py-2 px-1.5 border-b border-slate-700/50 min-w-[44px]`}>%</th>
            </tr>
          </thead>
          <tbody>
            {weekSummaries.map((ws, wIdx) => {
              const isCurrentWeek = wIdx === currentWeekIdx;
              const altBgClass = wIdx % 2 === 0 ? stickyBg : stickyBgAlt;
              const altBg = wIdx % 2 === 0 ? "bg-slate-900/20" : "bg-slate-800/10";

              return rowTypes.map((rowType, rIdx) => {
                const isFirstRow = rIdx === 0;
                const isRunRow = rowType === "run";
                const isExercise = exerciseKeys.includes(rowType);

                // Cell values
                let dayCells: (string | number)[] = [];
                let total = "";
                let plan = "";
                let pct = "";
                let pctVal = -1;
                let typeLabel = "";

                if (rowType === "walking") {
                  typeLabel = t("walk");
                  dayCells = ws.walking.map((v) => (v > 0 ? v.toFixed(1) : ""));
                  total = ws.totals.walkKm > 0 ? ws.totals.walkKm.toFixed(1) : "";
                } else if (rowType === "run") {
                  typeLabel = t("run");
                  dayCells = ws.run.map((v) => (v > 0 ? v.toFixed(1) : ""));
                  const totalKm = ws.totals.runKm;
                  total = totalKm > 0 ? totalKm.toFixed(1) : "";
                  plan = ws.plannedKm > 0 ? Math.round(ws.plannedKm).toString() : "";
                  if (ws.plannedKm > 0) {
                    pctVal = (totalKm / ws.plannedKm) * 100;
                    pct = pctStr(totalKm, ws.plannedKm);
                  }
                } else if (isExercise) {
                  typeLabel = exerciseLabels[rowType] || rowType;
                  const exDays = ws.exercises[rowType] || [];
                  dayCells = exDays.map((v) => (v > 0 ? v : ""));
                  const exTotal = ws.totals.exercises[rowType] || 0;
                  const exTarget = exerciseTargets[rowType] || DEFAULT_WEEKLY_TARGET;
                  total = exTotal > 0 ? exTotal.toString() : "0";
                  plan = exTarget.toString();
                  pctVal = (exTotal / exTarget) * 100;
                  pct = pctStr(exTotal, exTarget);
                }

                const topBorder = isFirstRow ? "border-t border-slate-600/40" : "";
                const currentRing = isCurrentWeek && isFirstRow ? "ring-1 ring-inset ring-green-500/30" : "";
                const runHighlight = isRunRow ? "bg-slate-700/15" : "";

                return (
                  <tr
                    key={`${ws.weekNumber}-${rowType}`}
                    ref={isCurrentWeek && isFirstRow ? currentWeekRef : undefined}
                    className={`${altBg} ${topBorder} ${currentRing} ${runHighlight}`}
                  >
                    {/* Date — sticky col 1 */}
                    <td
                      className={`${stickyBase} ${STICKY_W} ${altBgClass} py-1 px-1.5 text-slate-300 font-medium whitespace-nowrap`}
                      style={isFirstRow ? { borderLeft: `2px solid ${getBorderColor(ws.phase)}` } : { borderLeft: "2px solid transparent" }}
                    >
                      {isFirstRow ? formatWeekDate(ws.weekStartDate) : ""}
                    </td>

                    {/* S# — sticky col 2 */}
                    <td className={`${stickyBase} ${STICKY_W2} ${altBgClass} py-1 px-0.5 text-center text-slate-500`}>
                      {isFirstRow ? ws.weekNumber : ""}
                    </td>

                    {/* Type — sticky col 3 (with shadow) */}
                    <td
                      className={`${stickyBase} ${STICKY_W3} ${altBgClass} py-1 px-1.5 font-medium ${stickyShadow} ${
                        isRunRow ? "text-blue-400" : isExercise ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {typeLabel}
                    </td>

                    {/* 7 day cells */}
                    {dayCells.map((val, dIdx) => {
                      const canEdit = isRunRow && onEditDay;
                      return (
                        <td
                          key={dIdx}
                          onClick={canEdit ? () => onEditDay(wIdx, dIdx, weeks[wIdx].days[dIdx]) : undefined}
                          className={`py-1 px-1.5 text-right tabular-nums ${
                            val ? "text-slate-200" : "text-slate-700"
                          } ${canEdit ? "cursor-pointer hover:bg-green-500/10 hover:text-green-300 transition-colors" : ""}`}
                        >
                          {val || (canEdit ? <span className="text-slate-700 group-hover:text-slate-500">·</span> : "")}
                        </td>
                      );
                    })}

                    {/* Total */}
                    <td className="py-1 px-1.5 text-right font-medium text-slate-200 whitespace-nowrap tabular-nums">
                      {total}
                    </td>

                    {/* Plan */}
                    <td className="py-1 px-1.5 text-right text-slate-500 tabular-nums">
                      {plan}
                    </td>

                    {/* % */}
                    <td
                      className={`py-1 px-1.5 text-right font-medium tabular-nums ${
                        pctVal >= 0 ? pctColor(pctVal) : ""
                      }`}
                    >
                      {pct}
                    </td>
                  </tr>
                );
              });
            })}

            {/* Grand totals */}
            <tr className="bg-slate-800/50 border-t-2 border-slate-600/60 font-medium">
              <td className={`${stickyBase} ${STICKY_W} bg-[#161b26] py-2 px-1.5 text-slate-200`}>{t("grandTotal")}</td>
              <td className={`${stickyBase} ${STICKY_W2} bg-[#161b26] py-2 px-0.5`} />
              <td className={`${stickyBase} ${STICKY_W3} bg-[#161b26] py-2 px-1.5 text-slate-500 ${stickyShadow}`}>{t("walk")}</td>
              {Array.from({ length: 7 }).map((_, i) => (
                <td key={i} className="py-2 px-1.5" />
              ))}
              <td className="py-2 px-1.5 text-right text-slate-200 whitespace-nowrap tabular-nums">
                {grandTotals.walkKm.toFixed(1)}
              </td>
              <td className="py-2 px-1.5" />
              <td className="py-2 px-1.5" />
            </tr>
            <tr className="bg-slate-800/50 font-medium">
              <td className={`${stickyBase} ${STICKY_W} bg-[#161b26] py-1 px-1.5`} />
              <td className={`${stickyBase} ${STICKY_W2} bg-[#161b26] py-1 px-0.5`} />
              <td className={`${stickyBase} ${STICKY_W3} bg-[#161b26] py-1 px-1.5 text-blue-400 ${stickyShadow}`}>{t("run")}</td>
              {Array.from({ length: 7 }).map((_, i) => (
                <td key={i} className="py-1 px-1.5" />
              ))}
              <td className="py-1 px-1.5 text-right text-blue-400 whitespace-nowrap tabular-nums">
                {grandTotals.runKm.toFixed(1)}
              </td>
              <td className="py-1 px-1.5 text-right text-slate-500 tabular-nums">
                {Math.round(grandTotals.plannedKm)}
              </td>
              <td
                className={`py-1 px-1.5 text-right tabular-nums ${
                  grandTotals.plannedKm > 0
                    ? pctColor((grandTotals.runKm / grandTotals.plannedKm) * 100)
                    : ""
                }`}
              >
                {grandTotals.plannedKm > 0
                  ? pctStr(grandTotals.runKm, grandTotals.plannedKm)
                  : ""}
              </td>
            </tr>
            {exerciseKeys.map((ex) => {
              const total = grandTotals.exercises[ex] || 0;
              const target = grandTotals.totalExTargets[ex] || 0;
              const p = target > 0 ? (total / target) * 100 : 0;
              return (
                <tr key={`total-${ex}`} className="bg-slate-800/50">
                  <td className={`${stickyBase} ${STICKY_W} bg-[#161b26] py-1 px-1.5`} />
                  <td className={`${stickyBase} ${STICKY_W2} bg-[#161b26] py-1 px-0.5`} />
                  <td className={`${stickyBase} ${STICKY_W3} bg-[#161b26] py-1 px-1.5 text-slate-400 ${stickyShadow}`}>
                    {exerciseLabels[ex] || ex}
                  </td>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <td key={i} className="py-1 px-1.5" />
                  ))}
                  <td className="py-1 px-1.5 text-right text-slate-300 tabular-nums">
                    {total}
                  </td>
                  <td className="py-1 px-1.5 text-right text-slate-500 tabular-nums">
                    {target}
                  </td>
                  <td className={`py-1 px-1.5 text-right tabular-nums ${pctColor(p)}`}>
                    {pctStr(total, target)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase border color (raw hex for inline style)                       */
/* ------------------------------------------------------------------ */

function getBorderColor(phase: Phase): string {
  const map: Record<Phase, string> = {
    base: "#3b82f6",
    build: "#22c55e",
    peak: "#f97316",
    taper: "#a855f7",
    race: "#ef4444",
  };
  return map[phase] || "#64748b";
}
