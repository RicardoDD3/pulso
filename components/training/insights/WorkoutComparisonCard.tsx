"use client";

import { useTranslations } from "next-intl";
import type { WorkoutComparison } from "@/lib/training/plan-insights";

interface WorkoutComparisonCardProps {
  comparison: WorkoutComparison;
}

function formatPace(pace: number): string {
  if (!Number.isFinite(pace) || pace <= 0) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  // If rounding pushes secs to 60, roll over to next minute
  if (secs >= 60) return `${mins + 1}:00`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function distanceColor(planned: number, actual: number): string {
  if (planned <= 0) return "text-slate-200";
  const ratio = actual / planned;
  if (ratio >= 0.9 && ratio <= 1.1) return "text-green-400";
  if (ratio >= 0.8 && ratio <= 1.2) return "text-slate-200";
  return "text-red-400";
}

export default function WorkoutComparisonCard({ comparison }: WorkoutComparisonCardProps) {
  const t = useTranslations("training.insights.comparison");
  const { planned, actual, executionScore } = comparison;

  // Score badge colors
  const scoreBg =
    executionScore >= 80
      ? "bg-green-500/20 text-green-400"
      : executionScore >= 60
        ? "bg-amber-500/20 text-amber-400"
        : "bg-red-500/20 text-red-400";

  // Distance delta
  const distDelta = actual.distanceKm - planned.distanceKm;
  const distDeltaStr =
    distDelta >= 0
      ? `+${distDelta.toFixed(1)}`
      : distDelta.toFixed(1);

  return (
    <div className="bg-slate-800/50 rounded-xl p-3">
      {/* Execution score badge */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${scoreBg}`}
        >
          {executionScore}
        </span>
        <span className="text-[11px] text-slate-500 uppercase">{t("execution")}</span>
      </div>

      {/* Comparison grid */}
      <div className="grid grid-cols-3 gap-2">
        {/* Header row */}
        <div className="text-[11px] text-slate-500 uppercase">{t("plan")}</div>
        <div className="text-[11px] text-slate-500 uppercase">{t("real")}</div>
        <div className="text-[11px] text-slate-500 uppercase">{t("delta")}</div>

        {/* Row 1: distance */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("distance")}</div>
          <div className="text-[11px] text-slate-200">{planned.distanceKm.toFixed(1)} km</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("distance")}</div>
          <div className={`text-[11px] ${distanceColor(planned.distanceKm, actual.distanceKm)}`}>
            {actual.distanceKm.toFixed(1)} km
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">&nbsp;</div>
          <div className="text-[11px] text-slate-200">{distDeltaStr} km</div>
        </div>

        {/* Row 2: pace */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("pace")}</div>
          <div className="text-[11px] text-slate-200">{planned.pace ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("pace")}</div>
          <div className="text-[11px] text-slate-200">
            {actual.pace != null ? `${formatPace(actual.pace)} ${t("minPerKm")}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">&nbsp;</div>
          <div className="text-[11px] text-slate-200">—</div>
        </div>

        {/* Row 3: HR */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("hr")}</div>
          <div className="text-[11px] text-slate-200">{planned.hrZone ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">{t("hr")}</div>
          <div className="text-[11px] text-slate-200">
            {actual.avgHr != null ? `${actual.avgHr} bpm` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase">&nbsp;</div>
          <div className="text-[11px] text-slate-200">—</div>
        </div>
      </div>
    </div>
  );
}
