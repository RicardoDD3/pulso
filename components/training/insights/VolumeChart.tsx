"use client";

import { useTranslations } from "next-intl";
import type { GeneratedWeek, Phase } from "@/lib/training/plan-generator-types";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { PANEL_CLASS } from "./adapters";

interface VolumeChartProps {
  weeks: GeneratedWeek[];
  peakWeeklyKm: number;
  /** Km reales del wearable por semana (null en semanas futuras). */
  actualKmByWeek?: (number | null)[];
}

const ACTUAL_COLOR = "#22d3ee";

const PHASE_FILL: Record<Phase, string> = {
  base: "#3b82f6",
  build: "#22c55e",
  peak: "#f97316",
  taper: "#a855f7",
  race: "#ef4444",
};

interface ChartDatum {
  name: string;
  totalKm: number;
  actualKm: number | null;
  phase: Phase;
  weekNumber: number;
  isRestWeek: boolean;
  fill: string;
}

export default function VolumeChart({ weeks, peakWeeklyKm, actualKmByWeek }: VolumeChartProps) {
  const t = useTranslations("training.insights.volume");
  const tPhases = useTranslations("training.insights.phases");

  const data: ChartDatum[] = weeks.map((w, i) => ({
    name: t("weekShort", { n: w.weekNumber }),
    totalKm: Math.round(w.totalKm * 10) / 10,
    actualKm: actualKmByWeek?.[i] ?? null,
    phase: w.phase,
    weekNumber: w.weekNumber,
    isRestWeek: w.isRestWeek,
    fill: PHASE_FILL[w.phase] || PHASE_FILL.base,
  }));

  // Determine current week
  const today = new Date().toISOString().split("T")[0];
  const currentWeekIdx = weeks.findIndex((w) => {
    if (w.days.length === 0) return false;
    const firstDate = w.days[0].date;
    const lastDate = w.days[w.days.length - 1].date;
    return today >= firstDate && today <= lastDate;
  });

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-4`}>
      <h3 className="text-sm font-medium text-slate-300 mb-3">{t("title")}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: -20 }}>
          <defs>
            {Object.entries(PHASE_FILL).map(([phase, color]) => (
              <linearGradient key={phase} id={`grad-${phase}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            interval={Math.max(0, Math.floor(weeks.length / 12) - 1)}
          />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "0.75rem",
            }}
            labelStyle={{ color: "#e2e8f0" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((value: any, name: any, props: any) => {
              const d = props?.payload as ChartDatum | undefined;
              if (name === "actualKm") {
                return [`${value ?? 0} km`, t("actual")];
              }
              return [
                `${value ?? 0} km${d?.isRestWeek ? ` ${t("restSuffix")}` : ""}`,
                d ? t("planPhase", { phase: tPhases(d.phase) }) : t("plan"),
              ];
            }) as never}
          />
          <ReferenceLine
            y={peakWeeklyKm}
            stroke="#f59e0b"
            strokeDasharray="6 3"
            label={{
              value: t("peak", { n: peakWeeklyKm }),
              position: "right",
              fill: "#f59e0b",
              fontSize: 10,
            }}
          />
          {currentWeekIdx >= 0 && (
            <ReferenceLine
              x={data[currentWeekIdx]?.name}
              stroke="#22c55e"
              strokeDasharray="4 2"
              label={{
                value: t("today"),
                position: "top",
                fill: "#22c55e",
                fontSize: 10,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="totalKm"
            stroke="#64748b"
            strokeWidth={2}
            fill="url(#grad-base)"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dot={(dotProps: any) => {
              const { cx, cy, index } = dotProps;
              const d = data[index];
              if (!d || cx == null || cy == null) return <circle key={index} cx={0} cy={0} r={0} fill="none" />;
              const isCurrent = index === currentWeekIdx;
              return (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={isCurrent ? 5 : 3}
                  fill={d.fill}
                  stroke={isCurrent ? "#22c55e" : "none"}
                  strokeWidth={isCurrent ? 2 : 0}
                />
              );
            }}
          />
          {/* Km reales del wearable por semana (hasta hoy) */}
          {actualKmByWeek && (
            <Line
              type="monotone"
              dataKey="actualKm"
              stroke={ACTUAL_COLOR}
              strokeWidth={2}
              connectNulls={false}
              dot={{ r: 2.5, fill: ACTUAL_COLOR, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Phase legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {(Object.entries(PHASE_FILL) as [Phase, string][]).map(([phase, color]) => (
          <div key={phase} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-slate-400">{tPhases(phase)}</span>
          </div>
        ))}
        {actualKmByWeek && (
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: ACTUAL_COLOR }} />
            <span className="text-[10px] text-slate-400">{t("actual")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
