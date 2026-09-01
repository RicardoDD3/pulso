"use client";

import { useLocale, useTranslations } from "next-intl";
import { RUN_TYPES, localISODate, type PlanWorkoutRow } from "./types";

type Props = {
  rows: PlanWorkoutRow[];
  targetKm: number | null;
};

function toNum(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function statusOf(row: PlanWorkoutRow, todayISO: string): "completed" | "missed" | "pending" {
  if (row.status === "completed") return "completed";
  if (row.date && row.date < todayISO) return "missed";
  return "pending";
}

const STATUS_STYLES = {
  completed: "border-emerald-800/70 bg-emerald-950/40",
  missed: "border-red-900/60 bg-red-950/30",
  pending: "border-zinc-800 bg-zinc-900",
} as const;

const STATUS_MARKS = {
  completed: <span className="text-emerald-400">✓</span>,
  missed: <span className="text-red-400">✗</span>,
  pending: <span className="text-zinc-500">·</span>,
} as const;

/** One column per day: planned session, matched actual, and status color. */
export function WeekCard({ rows, targetKm }: Props) {
  const t = useTranslations("training");
  const locale = useLocale();
  const todayISO = localISODate();

  // Group by day-of-week (0=Mon..6=Sun); a day can hold a run AND strength.
  const byDay = new Map<number, PlanWorkoutRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.dayOfWeek) ?? [];
    list.push(row);
    byDay.set(row.dayOfWeek, list);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

  const runRows = rows.filter((r) => RUN_TYPES.has(r.workoutType));
  const plannedKm = runRows.reduce((sum, r) => sum + (toNum(r.targetDistanceKm) ?? 0), 0);
  const actualKm = runRows.reduce((sum, r) => sum + (toNum(r.actualDistanceKm) ?? 0), 0);

  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map(([dow, dayRows]) => {
          const date = dayRows[0].date;
          const isToday = date === todayISO;
          return (
            <div
              key={dow}
              className={`space-y-2 rounded-xl border p-2 ${
                isToday ? "border-emerald-600/60" : "border-zinc-800"
              } bg-zinc-950/40`}
            >
              <p className="text-xs font-medium text-zinc-400">
                {date
                  ? `${weekdayFmt.format(new Date(`${date}T12:00:00`))} ${date.slice(8, 10)}`
                  : `#${dow + 1}`}
              </p>
              {dayRows.map((row) => {
                const status = statusOf(row, todayISO);
                const target = toNum(row.targetDistanceKm);
                const actual = toNum(row.actualDistanceKm);
                const pace = toNum(row.actualPace);
                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border px-2 py-1.5 text-xs ${STATUS_STYLES[status]}`}
                  >
                    <p className="flex items-center justify-between gap-1 font-semibold text-zinc-200">
                      <span className="truncate">
                        {t.has(`types.${row.workoutType}`)
                          ? t(`types.${row.workoutType}`)
                          : row.workoutType}
                      </span>
                      {STATUS_MARKS[status]}
                    </p>
                    {row.title ? <p className="truncate text-zinc-400">{row.title}</p> : null}
                    {target != null ? (
                      <p className="text-zinc-400">
                        {t("plan.targetKm")}: {target} km
                        {row.targetPaceRange ? ` · ${row.targetPaceRange}` : ""}
                      </p>
                    ) : null}
                    {actual != null ? (
                      <p className="text-emerald-300">
                        {t("plan.actual")}: {actual.toFixed(1)} km
                        {pace != null ? ` · ${pace.toFixed(2)}/km` : ""}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-300">{t("plan.weekTotal")}</span>
        <span className="text-zinc-400">
          {t("plan.planned")}: {plannedKm.toFixed(1)} km
          {targetKm != null ? ` (${t("plan.targetKm").toLowerCase()} ${targetKm} km)` : ""}
        </span>
        <span className="text-emerald-300">
          {t("plan.actual")}: {actualKm.toFixed(1)} km
        </span>
      </div>
    </div>
  );
}
