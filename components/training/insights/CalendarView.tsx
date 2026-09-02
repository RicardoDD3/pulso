"use client";

import { useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  GeneratedWeek,
  GeneratedDay,
  Phase,
} from "@/lib/training/plan-generator-types";
import { PHASE_COLORS, SESSION_COLORS } from "@/lib/training/plan-static-data";
import { PANEL_CLASS } from "./adapters";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

interface CalendarViewProps {
  weeks: GeneratedWeek[];
  onEditDay?: (weekIndex: number, dayIndex: number, day: GeneratedDay) => void;
}

interface DayLookup {
  day: GeneratedDay;
  week: GeneratedWeek;
  weekIndex: number;
  dayIndex: number;
}

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const PHASE_BAR_COLORS: Record<Phase, string> = {
  base: "bg-blue-500",
  build: "bg-green-500",
  peak: "bg-orange-500",
  taper: "bg-purple-500",
  race: "bg-red-500",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Build a lookup map keyed by ISO date string (YYYY-MM-DD) */
function buildDayMap(weeks: GeneratedWeek[]): Map<string, DayLookup> {
  const map = new Map<string, DayLookup>();
  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi];
    for (let di = 0; di < week.days.length; di++) {
      const day = week.days[di];
      map.set(day.date, { day, week, weekIndex: wi, dayIndex: di });
    }
  }
  return map;
}

/** Get all dates from the Monday before (or on) the 1st to the Sunday after (or on) the last day of the month */
function getMonthDates(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  // getDay(): 0=Sun, 1=Mon ... We want Monday as start
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1);

  const lastDay = new Date(year, month + 1, 0);
  const end = new Date(lastDay);
  while (end.getDay() !== 0) end.setDate(end.getDate() + 1);

  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Format a Date to ISO date string (YYYY-MM-DD) */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Get date range of the plan */
function getPlanDateRange(weeks: GeneratedWeek[]): { start: string; end: string } | null {
  if (weeks.length === 0) return null;
  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  if (firstWeek.days.length === 0 || lastWeek.days.length === 0) return null;
  return {
    start: firstWeek.days[0].date,
    end: lastWeek.days[lastWeek.days.length - 1].date,
  };
}

/** Get all months that contain plan data */
function getPlanMonths(weeks: GeneratedWeek[]): { year: number; month: number }[] {
  const months = new Set<string>();
  for (const week of weeks) {
    for (const day of week.days) {
      const [y, m] = day.date.split("-");
      months.add(`${y}-${m}`);
    }
  }
  return Array.from(months)
    .sort()
    .map((key) => {
      const [y, m] = key.split("-");
      return { year: parseInt(y), month: parseInt(m) - 1 };
    });
}

/** Get the starting month: today if within plan range, else first month of plan */
function getInitialMonth(weeks: GeneratedWeek[]): { year: number; month: number } {
  const range = getPlanDateRange(weeks);
  if (!range) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }

  const today = new Date().toISOString().split("T")[0];
  if (today >= range.start && today <= range.end) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }

  // Plan is in the future (or past), start at first month
  const [y, m] = range.start.split("-");
  return { year: parseInt(y), month: parseInt(m) - 1 };
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function CalendarDayCell({
  date,
  lookup,
  isCurrentMonth,
  isToday,
  onClick,
}: {
  date: Date;
  lookup: DayLookup | undefined;
  isCurrentMonth: boolean;
  isToday: boolean;
  onClick?: () => void;
}) {
  const t = useTranslations("training.insights.calendar");
  const tShort = useTranslations("training.insights.sessionsShort");
  const dayNum = date.getDate();

  if (!lookup) {
    // Empty cell — no plan data for this date
    return (
      <div
        className={`min-h-[48px] sm:min-h-[56px] md:min-h-[84px] rounded-lg border border-slate-800/30 p-1 sm:p-1.5 ${
          isCurrentMonth ? "bg-slate-900/20" : "bg-slate-900/10 opacity-40"
        } ${isToday ? "ring-2 ring-green-500/50" : ""}`}
      >
        <span
          className={`text-[10px] sm:text-xs ${
            isToday ? "text-green-400 font-bold" : "text-slate-600"
          }`}
        >
          {dayNum}
        </span>
      </div>
    );
  }

  const { day, week } = lookup;
  const sessionColor = SESSION_COLORS[day.sessionType] || SESSION_COLORS.rest;
  const phaseColor = PHASE_BAR_COLORS[week.phase] || "bg-slate-500";
  const isRest = day.sessionType === "rest";

  return (
    <div
      onClick={onClick}
      className={`min-h-[48px] sm:min-h-[56px] md:min-h-[84px] rounded-lg border border-slate-700/30 p-1 sm:p-1.5 relative overflow-hidden transition-all group ${
        sessionColor.bg
      } ${isToday ? "ring-2 ring-green-500/50 shadow-lg shadow-green-500/10" : ""} ${
        !isCurrentMonth ? "opacity-60" : ""
      } ${onClick ? "cursor-pointer hover:border-slate-500/60 hover:brightness-125 active:scale-[0.97]" : ""}`}
    >
      {/* Phase bar at top */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${phaseColor} opacity-60`} />

      {/* Day number + key session star + edit icon */}
      <div className="flex items-center justify-between mt-[2px]">
        <span
          className={`text-[10px] sm:text-xs font-medium ${
            isToday ? "text-green-400 font-bold" : "text-slate-500"
          }`}
        >
          {dayNum}
        </span>
        <div className="flex items-center gap-0.5">
          {onClick && (
            <span className="text-slate-500 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" title={t("edit")}>
              &#9998;
            </span>
          )}
          {day.isKeySession && (
            <span className="text-amber-400 text-[10px] sm:text-xs" title={t("keySession")}>
              &#9733;
            </span>
          )}
        </div>
      </div>

      {/* Session dot + label */}
      <div className="flex items-center gap-1 mt-0.5">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sessionColor.dot}`} />
        <span className="text-[9px] sm:text-[10px] font-semibold text-slate-300 uppercase">
          {tShort(day.sessionType)}
        </span>
        {day.strengthDay && (
          <span className="text-[8px] sm:text-[9px] font-bold text-indigo-400 uppercase" title={t("strengthDay")}>
            {t("strengthFlag")}
          </span>
        )}
      </div>

      {/* Distance — always show on both mobile and desktop if > 0 */}
      {!isRest && day.distanceKm > 0 && (
        <p className="text-[10px] sm:text-xs text-slate-200 font-medium mt-0.5">
          {day.distanceKm} km
        </p>
      )}

      {/* Desktop-only details */}
      {!isRest && (
        <div className="hidden md:block">
          {day.zone && (
            <p className="text-[9px] text-slate-400 mt-0.5">{day.zone}</p>
          )}
          {day.notes && (
            <p className="text-[9px] text-slate-500 mt-0.5 leading-tight line-clamp-2">
              {day.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Calendar Component                                             */
/* ------------------------------------------------------------------ */

export default function CalendarView({ weeks, onEditDay }: CalendarViewProps) {
  const t = useTranslations("training.insights.calendar");
  const tShort = useTranslations("training.insights.sessionsShort");
  const tDays = useTranslations("training.insights.days");
  const locale = useLocale();
  const initial = useMemo(() => getInitialMonth(weeks), [weeks]);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);

  const dayMap = useMemo(() => buildDayMap(weeks), [weeks]);
  const planMonths = useMemo(() => getPlanMonths(weeks), [weeks]);

  const todayStr = useMemo(() => {
    const now = new Date();
    return toISODate(now);
  }, []);

  const dates = useMemo(() => getMonthDates(year, month), [year, month]);

  const dateLocale = locale === "es" ? "es-MX" : locale;
  const monthName = (y: number, m: number) => {
    const raw = new Date(y, m, 1).toLocaleDateString(dateLocale, { month: "long" });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  // Check if a given month has plan data
  const monthHasPlanData = (y: number, m: number) =>
    planMonths.some((pm) => pm.year === y && pm.month === m);

  const hasCurrent = monthHasPlanData(year, month);

  // Navigation
  const goToPrev = () => {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  };

  const goToNext = () => {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  };

  // Determine nav limits based on plan data
  const firstPlanMonth = planMonths[0];
  const lastPlanMonth = planMonths[planMonths.length - 1];
  const canGoPrev =
    firstPlanMonth &&
    (year > firstPlanMonth.year ||
      (year === firstPlanMonth.year && month > firstPlanMonth.month));
  const canGoNext =
    lastPlanMonth &&
    (year < lastPlanMonth.year ||
      (year === lastPlanMonth.year && month < lastPlanMonth.month));

  // Split dates into rows of 7
  const gridRows: Date[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    gridRows.push(dates.slice(i, i + 7));
  }

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-3 sm:p-4`}>
      {/* Month navigation header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={goToPrev}
          disabled={!canGoPrev}
          className="p-2 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t("prevMonth")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="text-center">
          <h3 className="text-sm sm:text-base font-medium text-slate-200">
            {monthName(year, month)} {year}
          </h3>
          {/* Month dots showing which months have plan data */}
          <div className="flex items-center justify-center gap-1 mt-1">
            {planMonths.map((pm) => {
              const isActive = pm.year === year && pm.month === month;
              return (
                <button
                  key={`${pm.year}-${pm.month}`}
                  onClick={() => {
                    setYear(pm.year);
                    setMonth(pm.month);
                  }}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    isActive
                      ? "bg-green-400 w-3"
                      : "bg-slate-600 hover:bg-slate-400"
                  }`}
                  title={`${monthName(pm.year, pm.month)} ${pm.year}`}
                />
              );
            })}
          </div>
        </div>

        <button
          onClick={goToNext}
          disabled={!canGoNext}
          className="p-2 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t("nextMonth")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* No plan data indicator */}
      {!hasCurrent && (
        <div className="text-center text-xs text-slate-500 mb-3">
          {t("noData")}
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1">
        {DAY_KEYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 py-1"
          >
            {tDays(d)}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-1">
        {gridRows.map((row, rowIdx) => (
          <div key={rowIdx} className="grid grid-cols-7 gap-0.5 sm:gap-1">
            {row.map((date) => {
              const isoDate = toISODate(date);
              const lookup = dayMap.get(isoDate);
              const isCurrentMonth = date.getMonth() === month;
              const isToday = isoDate === todayStr;

              return (
                <CalendarDayCell
                  key={isoDate}
                  date={date}
                  lookup={lookup}
                  isCurrentMonth={isCurrentMonth}
                  isToday={isToday}
                  onClick={
                    lookup && onEditDay
                      ? () => onEditDay(lookup.weekIndex, lookup.dayIndex, lookup.day)
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-slate-700/30">
        {Object.entries(SESSION_COLORS).map(([key, style]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${style.dot}`} />
            <span className="text-[10px] text-slate-500">{tShort(key)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-amber-400 text-[10px]">&#9733;</span>
          <span className="text-[10px] text-slate-500">{t("key")}</span>
        </div>
      </div>

      {/* Phase legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {(Object.entries(PHASE_BAR_COLORS) as [Phase, string][]).map(([phase, color]) => (
          <div key={phase} className="flex items-center gap-1.5">
            <div className={`w-4 h-1 rounded-full ${color} opacity-60`} />
            <span className={`text-[10px] ${PHASE_COLORS[phase]?.text || "text-slate-400"} capitalize`}>
              {phase}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
