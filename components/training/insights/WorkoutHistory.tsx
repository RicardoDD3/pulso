"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PANEL_CLASS, type WorkoutJson } from "./adapters";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MergedEntry {
  id: string;
  date: string;
  type: string;
  title: string;
  source: "wearable" | "manual";
  provider?: string;
  distance_km?: number;
  pace?: string;
  avg_hr?: number;
  duration_min?: number;
  exercise_count?: number;
}

const TYPE_BORDER_COLORS: Record<string, string> = {
  running: "border-l-blue-400",
  strength: "border-l-purple-400",
  mobility: "border-l-teal-400",
  cross_training: "border-l-orange-400",
  cycling: "border-l-yellow-400",
  swimming: "border-l-cyan-400",
};

const HISTORY_DAYS = 180;

function paceFromSpeed(avgSpeedMps: number): string {
  if (!avgSpeedMps || avgSpeedMps <= 0) return "--";
  const paceMinPerKm = 1000 / avgSpeedMps / 60;
  const mins = Math.floor(paceMinPerKm);
  const secs = Math.round((paceMinPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export default function WorkoutHistory() {
  const t = useTranslations("training.insights.history");
  const locale = useLocale();
  const [entries, setEntries] = useState<MergedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const from = isoDaysAgo(HISTORY_DAYS);
        const to = new Date().toISOString().split("T")[0];
        const [wearableRes, manualRes] = await Promise.all([
          fetch(`/api/health/workouts?from=${from}&to=${to}&limit=500`)
            .then((r) => r.json())
            .catch(() => ({ workouts: [] })),
          fetch("/api/training/workouts").then((r) => r.json()).catch(() => ({ workouts: [] })),
        ]);

        const wearableEntries: MergedEntry[] = ((wearableRes.workouts || []) as WorkoutJson[]).map((a) => ({
          id: `g-${a.id}`,
          date: a.startAt?.split("T")[0] || "",
          type: (a.sport || "running").toLowerCase(),
          title: a.name || a.sport || "Running",
          source: "wearable" as const,
          provider: a.provider,
          distance_km: a.distanceM ? Math.round((a.distanceM / 1000) * 100) / 100 : undefined,
          pace: a.speedAvgMps ? paceFromSpeed(a.speedAvgMps) : undefined,
          avg_hr: a.hrAvg || undefined,
          duration_min: a.durationS ? Math.round(a.durationS / 60) : undefined,
        }));

        const manualEntries: MergedEntry[] = (manualRes.workouts || []).map((w: any) => ({
          id: `m-${w.id}`,
          date: w.date,
          type: w.workoutType,
          title: w.title || w.workoutType,
          source: "manual" as const,
          duration_min: w.durationMinutes || undefined,
          exercise_count: Array.isArray(w.exercises) ? w.exercises.length : 0,
        }));

        const merged = [...wearableEntries, ...manualEntries].sort(
          (a, b) => b.date.localeCompare(a.date)
        );

        setEntries(merged);
      } catch (e) {
        console.error("[WorkoutHistory] error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="text-center text-slate-500 py-8">{t("loading")}</div>;
  }

  if (entries.length === 0) {
    return <div className="text-center text-slate-500 py-8">{t("empty")}</div>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`${PANEL_CLASS} rounded-xl p-4 border-l-4 ${TYPE_BORDER_COLORS[entry.type] || "border-l-slate-500"}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-200">{entry.title}</p>
              <div className="flex gap-3 mt-1 text-xs text-slate-500">
                <span>
                  {new Date(entry.date + "T12:00:00").toLocaleDateString(
                    locale === "es" ? "es-MX" : locale,
                    { weekday: "short", day: "numeric", month: "short" }
                  )}
                </span>
                <span className="capitalize">{entry.type.replace("_", " ")}</span>
                {entry.source === "wearable" && (
                  <span className="text-blue-400 capitalize">{entry.provider || t("wearable")}</span>
                )}
                {entry.source === "manual" && <span className="text-purple-400">{t("manual")}</span>}
              </div>
            </div>
            <div className="text-right text-xs text-slate-400 space-y-0.5">
              {entry.distance_km != null && <p>{entry.distance_km} km</p>}
              {entry.pace && <p>{entry.pace}</p>}
              {entry.avg_hr != null && <p>{entry.avg_hr} bpm</p>}
              {entry.duration_min != null && <p>{entry.duration_min} min</p>}
              {entry.exercise_count != null && entry.exercise_count > 0 && (
                <p>{t("exercises", { n: entry.exercise_count })}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
