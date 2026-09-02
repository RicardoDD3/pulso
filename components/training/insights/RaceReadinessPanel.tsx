"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RaceReadiness, SemaphoreColor } from "@/lib/training/plan-insights";
import { PANEL_CLASS } from "./adapters";

interface RaceReadinessPanelProps {
  readiness: RaceReadiness;
  daysToRace: number;
}

const SEMAPHORE_DOT: Record<SemaphoreColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const OVERALL_TEXT: Record<SemaphoreColor, string> = {
  green: "text-green-400",
  yellow: "text-amber-400",
  red: "text-red-400",
};

export default function RaceReadinessPanel({ readiness, daysToRace }: RaceReadinessPanelProps) {
  const t = useTranslations("training.insights.readiness");
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`${PANEL_CLASS} rounded-2xl overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left flex items-center justify-between hover:bg-slate-800/30 transition-colors"
      >
        <span className="text-sm font-medium text-green-400">{t("title")}</span>
        <span className="text-slate-600 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-slate-500 mb-2">{t("daysToRace", { n: daysToRace })}</p>

          {/* Volume */}
          <div className="flex items-center gap-3 py-2 border-b border-slate-700/30">
            <span className={`w-3 h-3 rounded-full ${SEMAPHORE_DOT[readiness.volumeCompliance]}`} />
            <span className="text-sm text-slate-300 flex-1">{t("volume")}</span>
            <span className="text-sm font-medium text-slate-200">{readiness.volumePct}%</span>
          </div>

          {/* Long Run */}
          <div className="flex items-center gap-3 py-2 border-b border-slate-700/30">
            <span className={`w-3 h-3 rounded-full ${SEMAPHORE_DOT[readiness.longRunColor]}`} />
            <span className="text-sm text-slate-300 flex-1">{t("longRunMax")}</span>
            <span className="text-sm font-medium text-slate-200">
              {readiness.longRunMax} km ({readiness.longRunPct}%)
            </span>
          </div>

          {/* Consistency */}
          <div className="flex items-center gap-3 py-2 border-b border-slate-700/30">
            <span className={`w-3 h-3 rounded-full ${SEMAPHORE_DOT[readiness.consistencyColor]}`} />
            <span className="text-sm text-slate-300 flex-1">{t("consistency")}</span>
            <span className="text-sm font-medium text-slate-200">{readiness.consistencyPct}%</span>
          </div>

          {/* Health */}
          <div className="flex items-center gap-3 py-2 border-b border-slate-700/30">
            <span className={`w-3 h-3 rounded-full ${SEMAPHORE_DOT[readiness.healthStatus]}`} />
            <span className="text-sm text-slate-300 flex-1">{t("health")}</span>
            <span className="text-sm font-medium text-slate-200">{readiness.healthDetails}</span>
          </div>

          {/* Overall score */}
          <div className="mt-3 pt-3 border-t border-slate-700/30 text-center">
            <p className={`text-3xl font-bold ${OVERALL_TEXT[readiness.overallColor]}`}>
              {readiness.overallScore}
            </p>
            <p className="text-xs text-slate-500">{t("score")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
