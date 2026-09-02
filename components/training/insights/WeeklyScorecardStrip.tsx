"use client";

import { useTranslations } from "next-intl";
import type { WeeklyScorecard } from "@/lib/training/plan-insights";
import { PHASE_COLORS, SESSION_COLORS } from "@/lib/training/plan-static-data";

interface WeeklyScorecardStripProps {
  scorecard: WeeklyScorecard;
}

export default function WeeklyScorecardStrip({ scorecard }: WeeklyScorecardStripProps) {
  const t = useTranslations("training.insights.scorecard");
  const phaseColor = PHASE_COLORS[scorecard.phase] ?? PHASE_COLORS.base;
  const progressPct =
    scorecard.totalPlannedKm > 0
      ? Math.min(100, (scorecard.totalActualKm / scorecard.totalPlannedKm) * 100)
      : 0;

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
      {/* Title row */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">
          {t("week", { n: scorecard.weekNumber })}
        </h3>
        <span
          className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${phaseColor.badge}`}
        >
          {scorecard.phase}
        </span>
      </div>

      {/* 7-day grid */}
      <div className="overflow-x-auto -mx-1">
        <div className="grid grid-cols-7 gap-1" style={{ minWidth: "336px" }}>
          {scorecard.days.map((day) => {
            const sessionColor =
              SESSION_COLORS[day.sessionType as keyof typeof SESSION_COLORS] ??
              SESSION_COLORS.rest;
            const isRest = day.sessionType === "rest";

            return (
              <div key={day.date} className="flex flex-col items-center gap-1 min-w-[48px] py-1">
                {/* Day label */}
                <span className="text-[10px] text-slate-500 uppercase leading-none">
                  {day.dayLabel}
                </span>

                {/* Colored dot */}
                <div className={day.isToday ? "ring-2 ring-green-400/50 rounded-full p-0.5" : ""}>
                  <div className={`w-2.5 h-2.5 rounded-full ${sessionColor.dot}`} />
                </div>

                {/* Status indicator */}
                {isRest ? (
                  <span className="text-xs text-slate-600 leading-none">-</span>
                ) : day.isCompleted ? (
                  <span className="text-xs text-green-400 leading-none">{"✓"}</span>
                ) : (
                  <span className="text-xs text-slate-600 leading-none">{"○"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="w-full bg-slate-800 rounded-full h-2">
          <div
            className="bg-green-500 rounded-full h-2 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-slate-400 mt-1">
          {t("progress", {
            actual: scorecard.totalActualKm,
            planned: scorecard.totalPlannedKm,
            completed: scorecard.completedSessions,
            total: scorecard.totalSessions,
          })}
        </p>
      </div>
    </div>
  );
}
