"use client";

import { useTranslations } from "next-intl";
import type { SessionType } from "@/lib/training/plan-generator-types";
import type { GeneratedDay } from "@/lib/training/plan-generator-types";
import type { ReadinessScore, ReadinessLevel } from "@/lib/training/plan-insights";
import { SESSION_COLORS } from "@/lib/training/plan-static-data";
import { PANEL_CLASS } from "./adapters";

interface TodayWorkoutCardProps {
  todaySession: GeneratedDay | null;
  readiness: ReadinessScore | null;
  loading: boolean;
}

const READINESS_STROKE: Record<ReadinessLevel, string> = {
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
};

function ReadinessGauge({ readiness }: { readiness: ReadinessScore | null }) {
  const t = useTranslations("training.insights.today");
  const radius = 40;
  const strokeWidth = 6;
  const circumference = 2 * Math.PI * radius;
  const center = radius + strokeWidth;
  const size = (radius + strokeWidth) * 2;

  if (!readiness) {
    return (
      <div className="flex flex-col items-center justify-center">
        <svg width={size} height={size}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#334155"
            strokeWidth={strokeWidth}
          />
          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            className="text-xl font-bold"
            fill="#64748b"
          >
            —
          </text>
        </svg>
      </div>
    );
  }

  const fraction = Math.min(1, Math.max(0, readiness.composite / 100));
  const arcLength = circumference * fraction;
  const strokeColor = READINESS_STROKE[readiness.level];

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#334155"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeLinecap="round"
        />
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          className="text-xl font-bold"
          fill="#f1f5f9"
          style={{ transform: "rotate(90deg)", transformOrigin: `${center}px ${center}px` }}
        >
          {readiness.composite}
        </text>
      </svg>
      <span className="text-[10px] text-slate-400 mt-1">
        {t(`readiness.${readiness.level}`)}
      </span>
    </div>
  );
}

export default function TodayWorkoutCard({
  todaySession,
  readiness,
  loading,
}: TodayWorkoutCardProps) {
  const t = useTranslations("training.insights.today");
  const tSessions = useTranslations("training.insights.sessions");

  if (loading) {
    return (
      <div className={`${PANEL_CLASS} rounded-2xl p-5 animate-pulse`}>
        <div className="flex gap-4">
          <div className="flex-1 space-y-3">
            <div className="h-3 w-10 rounded bg-slate-700" />
            <div className="h-5 w-20 rounded bg-slate-700" />
            <div className="h-7 w-24 rounded bg-slate-700" />
            <div className="h-3 w-32 rounded bg-slate-700" />
          </div>
          <div className="w-28 flex items-center justify-center">
            <div className="h-20 w-20 rounded-full bg-slate-700" />
          </div>
        </div>
      </div>
    );
  }

  if (!todaySession || todaySession.sessionType === "rest") {
    // Día sin corrida pero con fuerza planeada (flag strengthDay)
    if (todaySession?.strengthDay) {
      return (
        <div className={`${PANEL_CLASS} rounded-2xl p-5 flex items-center justify-center gap-3`}>
          <span className="text-2xl">🏋️</span>
          <span className="text-indigo-300 text-sm font-medium">{t("todayStrength")}</span>
        </div>
      );
    }
    return (
      <div className={`${PANEL_CLASS} rounded-2xl p-5 flex items-center justify-center gap-3`}>
        <span className="text-2xl">🌙</span>
        <span className="text-slate-400 text-sm">{t("restDay")}</span>
      </div>
    );
  }

  const sessionType: SessionType = todaySession.sessionType;
  const colors = SESSION_COLORS[sessionType] ?? SESSION_COLORS.z2;

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-5`}>
      <div className="flex gap-4">
        {/* Left side */}
        <div className="flex-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            {t("label")}
          </span>

          {/* Session type badge */}
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
              {tSessions(sessionType)}
            </span>
            {todaySession.isKeySession && (
              <span className="text-amber-400 text-sm" title={t("keySession")}>
                ★
              </span>
            )}
          </div>

          {/* Distance */}
          <p className="text-2xl font-bold text-white mt-2">
            {todaySession.distanceKm} km
          </p>

          {/* Zone */}
          {todaySession.zone && (
            <p className="text-sm text-slate-400 mt-0.5">{todaySession.zone}</p>
          )}

          {/* Notes */}
          {todaySession.notes && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
              {todaySession.notes}
            </p>
          )}
        </div>

        {/* Right side — readiness gauge */}
        <div className="w-28 flex-shrink-0 flex items-center justify-center">
          <ReadinessGauge readiness={readiness} />
        </div>
      </div>

      {/* Warning banner */}
      {readiness?.suggestion && (
        <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2 text-xs text-amber-300">
          {readiness.suggestion}
        </div>
      )}
    </div>
  );
}
