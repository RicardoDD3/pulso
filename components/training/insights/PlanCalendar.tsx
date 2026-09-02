"use client";

import { useTranslations } from "next-intl";
import type { PlanWeek, TrainingPlanWorkout } from "@/lib/training/types";

const TYPE_STYLES: Record<string, { bg: string; border: string; text: string; key: string }> = {
  easy_run: { bg: "bg-green-500/15", border: "border-green-500/40", text: "text-green-400", key: "easy_run" },
  long_run: { bg: "bg-blue-500/15", border: "border-blue-500/40", text: "text-blue-400", key: "long_run" },
  tempo: { bg: "bg-orange-500/15", border: "border-orange-500/40", text: "text-orange-400", key: "tempo" },
  intervals: { bg: "bg-red-500/15", border: "border-red-500/40", text: "text-red-400", key: "intervals" },
  strength: { bg: "bg-purple-500/15", border: "border-purple-500/40", text: "text-purple-400", key: "strength" },
  rest: { bg: "bg-slate-500/10", border: "border-slate-700/30", text: "text-slate-500", key: "rest" },
  recovery_run: { bg: "bg-teal-500/15", border: "border-teal-500/40", text: "text-teal-400", key: "recovery_run" },
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface PlanCalendarProps {
  weeks: PlanWeek[];
  planWorkouts: TrainingPlanWorkout[];
  onToggleWorkout?: (workoutId: number, currentStatus: string) => void;
}

export default function PlanCalendar({ weeks, planWorkouts, onToggleWorkout }: PlanCalendarProps) {
  const t = useTranslations("training.insights.planCalendar");
  const tDays = useTranslations("training.insights.days");
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-1">
      {/* Day headers */}
      <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1">
        <div />
        {DAY_KEYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 py-1">
            {tDays(d)}
          </div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week) => {
        const isCurrentWeek =
          week.workouts.length > 0 &&
          today >= week.workouts[0].date &&
          today <= week.workouts[week.workouts.length - 1].date;

        // Build 7-day array (Mon=0 to Sun=6)
        const dayCells = Array.from({ length: 7 }, (_, dayIdx) => {
          const pw = week.workouts.find((w) => w.day_of_week === dayIdx);
          if (!pw) return null;

          const matched = planWorkouts.find(
            (w) => w.week_number === week.week_number && w.day_of_week === dayIdx
          );

          return { planned: pw, actual: matched };
        });

        const completedCount = planWorkouts.filter(
          (w) => w.week_number === week.week_number && w.status === "completed"
        ).length;
        const totalNonRest = week.workouts.filter((w) => w.workout_type !== "rest").length;

        return (
          <div
            key={week.week_number}
            className={`grid grid-cols-[80px_repeat(7,1fr)] gap-1 ${
              isCurrentWeek ? "ring-1 ring-green-500/40 rounded-lg" : ""
            }`}
          >
            {/* Week label */}
            <div className={`flex flex-col justify-center px-2 py-1 rounded-l-lg ${isCurrentWeek ? "bg-green-500/10" : ""}`}>
              <span className={`text-xs font-semibold ${isCurrentWeek ? "text-green-400" : "text-slate-300"}`}>
                {t("weekShort", { n: week.week_number })}
              </span>
              <span className="text-[10px] text-slate-500">{week.phase}</span>
              <span className="text-[10px] text-slate-600">{week.target_km} km</span>
              {totalNonRest > 0 && (
                <span className={`text-[9px] mt-0.5 ${completedCount === totalNonRest ? "text-green-500" : "text-slate-600"}`}>
                  {completedCount}/{totalNonRest}
                </span>
              )}
            </div>

            {/* Day cells */}
            {dayCells.map((cell, dayIdx) => {
              if (!cell) {
                return <div key={dayIdx} className="min-h-[72px] rounded-lg bg-slate-900/30" />;
              }

              const { planned, actual } = cell;
              const style = TYPE_STYLES[planned.workout_type] || TYPE_STYLES.rest;
              const isToday = planned.date === today;
              const isCompleted = actual?.status === "completed";
              const isPast = planned.date < today;
              const isMissed = isPast && !isCompleted && planned.workout_type !== "rest";
              const canToggle = actual?.id && actual.id > 0 && planned.workout_type !== "rest" && onToggleWorkout;

              return (
                <div
                  key={dayIdx}
                  onClick={() => canToggle && onToggleWorkout(actual.id, actual.status)}
                  className={`min-h-[72px] rounded-lg border p-1.5 transition-all relative overflow-hidden ${style.bg} ${style.border} ${
                    isToday ? "ring-2 ring-green-400/60 shadow-lg shadow-green-500/10" : ""
                  } ${isMissed ? "opacity-50" : ""} ${canToggle ? "cursor-pointer hover:brightness-125" : ""}`}
                >
                  {/* Date */}
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-[9px] ${isToday ? "text-green-400 font-bold" : "text-slate-600"}`}>
                      {planned.date.slice(5)}
                    </span>
                    {isCompleted && <span className="text-green-400 text-[10px]">&#10003;</span>}
                    {isMissed && <span className="text-red-400/60 text-[10px]">!</span>}
                  </div>

                  {/* Workout type badge */}
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
                    {t(`types.${style.key}`)}
                  </span>

                  {/* Title */}
                  {planned.workout_type !== "rest" && (
                    <p className="text-[10px] text-slate-300 leading-tight mt-0.5 line-clamp-2">
                      {planned.title}
                    </p>
                  )}

                  {/* Target */}
                  {planned.target_distance_km != null && planned.target_distance_km > 0 && (
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {planned.target_distance_km} km
                    </span>
                  )}

                  {/* Actual overlay */}
                  {isCompleted && actual?.actual_distance_km != null && (
                    <div className="text-[10px] text-green-400 mt-0.5 font-medium">
                      {t("kmReal", { n: actual.actual_distance_km.toFixed(1) })}
                    </div>
                  )}

                  {/* Pace targets */}
                  {planned.target_pace_range && (
                    <span className="text-[9px] text-slate-500 block">{planned.target_pace_range}</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 px-2">
        {Object.entries(TYPE_STYLES).map(([key, style]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${style.bg} border ${style.border}`} />
            <span className="text-[10px] text-slate-500">{t(`types.${style.key}`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
