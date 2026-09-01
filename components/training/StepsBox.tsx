"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { localISODate } from "./types";

type StepsDay = { date: string; steps: number };

/** Current-week (Mon–Sun) steps total vs the weekly goal (spec doc 09). */
export function StepsBox() {
  const t = useTranslations("training.steps");
  const [total, setTotal] = useState<number | null>(null);
  const [goal, setGoal] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const from = localISODate(monday);
    const to = localISODate(sunday);

    void (async () => {
      try {
        const [stepsRes, settingsRes] = await Promise.all([
          fetch(`/api/health/steps?from=${from}&to=${to}`),
          fetch("/api/training/settings"),
        ]);
        if (stepsRes.ok) {
          const json = await stepsRes.json();
          const days = (json.steps ?? []) as StepsDay[];
          setTotal(days.reduce((sum, d) => sum + (d.steps ?? 0), 0));
        }
        if (settingsRes.ok) {
          const json = await settingsRes.json();
          setGoal({ min: json.stepsGoalMin, max: json.stepsGoalMax });
        }
      } catch {
        /* the box stays empty; Training keeps working (spec doc 09) */
      }
    })();
  }, []);

  const pct =
    total != null && goal ? Math.min(100, Math.round((total / goal.min) * 100)) : 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-300">{t("title")}</span>
        {goal ? (
          <span className="text-xs text-zinc-500">
            {t("goal", {
              min: goal.min.toLocaleString(),
              max: goal.max.toLocaleString(),
            })}
          </span>
        ) : null}
      </div>
      {total == null || total === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {total.toLocaleString()}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}
