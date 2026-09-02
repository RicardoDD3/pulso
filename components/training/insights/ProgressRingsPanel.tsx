"use client";

import { useTranslations } from "next-intl";
import type { ProgressRings, Badge } from "@/lib/training/plan-insights";
import { PANEL_CLASS } from "./adapters";

interface ProgressRingsPanelProps {
  rings: ProgressRings;
}

const CIRCUMFERENCE = 2 * Math.PI * 38; // ~238.76

interface RingProps {
  percentage: number;
  colorClass: string;
  label: string;
}

function Ring({ percentage, colorClass, label }: RingProps) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center">
      <svg width={100} height={100} viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx={50}
          cy={50}
          r={38}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          className="text-slate-700"
        />
        {/* Foreground arc */}
        <circle
          cx={50}
          cy={50}
          r={38}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          className={colorClass}
          style={{ transition: "stroke-dashoffset 1s ease-in-out" }}
        />
        {/* Center text */}
        <text
          x={50}
          y={50}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-slate-200 text-lg font-bold"
          style={{ fontSize: "18px", fontWeight: 700 }}
        >
          {percentage}%
        </text>
      </svg>
      <span className="text-[10px] text-slate-500 uppercase text-center mt-1">{label}</span>
    </div>
  );
}

function BadgeItem({ badge }: { badge: Badge }) {
  const isUnlocked = badge.unlocked;

  return (
    <div
      className={`rounded-lg p-2 text-center ${
        isUnlocked
          ? "bg-green-500/10 border border-green-500/20"
          : "bg-slate-800/30 border border-slate-700/30 opacity-40"
      }`}
    >
      <div
        className={`text-xs font-medium ${isUnlocked ? "text-green-400" : "text-slate-500"}`}
      >
        {!isUnlocked && "🔒 "}
        {badge.name}
      </div>
      <div className="text-[10px] text-slate-500">{badge.description}</div>
    </div>
  );
}

export default function ProgressRingsPanel({ rings }: ProgressRingsPanelProps) {
  const t = useTranslations("training.insights.rings");

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-5`}>
      <h3 className="text-sm font-medium text-slate-300 mb-4">{t("title")}</h3>

      {/* Rings row */}
      <div className="flex justify-around items-center">
        <Ring percentage={rings.consistency} colorClass="text-green-400" label={t("consistency")} />
        <Ring percentage={rings.volume} colorClass="text-blue-400" label={t("volume")} />
        <Ring percentage={rings.longRun} colorClass="text-amber-400" label={t("longRun")} />
      </div>

      {/* Badges grid */}
      {rings.badges.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {rings.badges.map((badge) => (
            <BadgeItem key={badge.id} badge={badge} />
          ))}
        </div>
      )}
    </div>
  );
}
