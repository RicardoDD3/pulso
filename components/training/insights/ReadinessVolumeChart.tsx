"use client";

import { useTranslations } from "next-intl";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { PANEL_CLASS } from "./adapters";

interface ReadinessVolumeChartProps {
  weeklyTrends: {
    weekNumber: number;
    totalKm: number;
    avgHrv: number | null;
    avgSleepScore: number | null;
  }[];
  currentWeekNumber: number;
}

function CustomTooltip({
  active,
  payload,
  label,
  labels,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null; color: string }[];
  label?: number;
  labels: { week: (n: number) => string; volume: string; hrv: string; sleep: string };
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-xl border px-3 py-2 text-xs"
      style={{
        backgroundColor: "#1e293b",
        border: "1px solid #334155",
      }}
    >
      <p className="text-slate-300 font-medium mb-1">{labels.week(label ?? 0)}</p>
      {payload.map((entry) => {
        if (entry.value == null) return null;
        let labelText = "";
        let unit = "";
        if (entry.dataKey === "totalKm") {
          labelText = labels.volume;
          unit = " km";
        } else if (entry.dataKey === "avgHrv") {
          labelText = labels.hrv;
          unit = " ms";
        } else if (entry.dataKey === "avgSleepScore") {
          labelText = labels.sleep;
          unit = "";
        }
        return (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {labelText}: {entry.value}{unit}
          </p>
        );
      })}
    </div>
  );
}

export default function ReadinessVolumeChart({
  weeklyTrends,
  currentWeekNumber,
}: ReadinessVolumeChartProps) {
  const t = useTranslations("training.insights.readinessVolume");

  if (weeklyTrends.length === 0) {
    return (
      <div className={`${PANEL_CLASS} rounded-2xl p-4`}>
        <h3 className="text-sm font-medium text-slate-300 mb-3">{t("title")}</h3>
        <div className="flex items-center justify-center h-[220px] text-sm text-slate-500">
          {t("noData")}
        </div>
      </div>
    );
  }

  const maxKm = Math.max(...weeklyTrends.map((d) => d.totalKm), 1);

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-4`}>
      <h3 className="text-sm font-medium text-slate-300 mb-3">{t("title")}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart
          data={weeklyTrends}
          margin={{ top: 10, right: 10, bottom: 5, left: -20 }}
        >
          <defs>
            <linearGradient id="gradVolume" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="weekNumber"
            tickFormatter={(n: number) => t("weekShort", { n })}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            domain={[0, Math.ceil(maxKm * 1.1)]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={false}
            label={{
              value: t("hrvSleepAxis"),
              angle: -90,
              position: "insideRight",
              fill: "#64748b",
              fontSize: 10,
              dx: 15,
            }}
          />
          <Tooltip
            content={
              <CustomTooltip
                labels={{
                  week: (n: number) => t("week", { n }),
                  volume: t("volumeLabel"),
                  hrv: t("hrv"),
                  sleep: t("sleep"),
                }}
              />
            }
          />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
            formatter={(value: string) => {
              if (value === "totalKm") return t("volumeKm");
              if (value === "avgHrv") return t("hrv");
              if (value === "avgSleepScore") return t("sleep");
              return value;
            }}
          />
          <ReferenceLine
            x={currentWeekNumber}
            yAxisId="left"
            stroke="#22c55e"
            strokeDasharray="3 3"
            label={{
              value: t("today"),
              position: "top",
              fill: "#22c55e",
              fontSize: 10,
            }}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="totalKm"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#gradVolume)"
            dot={{ r: 3, fill: "#22c55e" }}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgHrv"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3, fill: "#60a5fa" }}
            connectNulls
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgSleepScore"
            stroke="#c084fc"
            strokeWidth={2}
            dot={{ r: 3, fill: "#c084fc" }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
