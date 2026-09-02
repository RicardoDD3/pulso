"use client";

import { useTranslations } from "next-intl";
import type { TrainingPlanWorkout, PlanWeek } from "@/lib/training/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { PANEL_CLASS } from "./adapters";

interface ComplianceChartProps {
  planWorkouts: TrainingPlanWorkout[];
  weeks: PlanWeek[];
}

export default function ComplianceChart({ planWorkouts, weeks }: ComplianceChartProps) {
  const t = useTranslations("training.insights.compliance");
  const data = weeks.map((w) => {
    const weekWorkouts = planWorkouts.filter((pw) => pw.week_number === w.week_number);
    const actualKm = weekWorkouts.reduce((sum, pw) => sum + (pw.actual_distance_km || 0), 0);
    const completedNonRest = weekWorkouts.filter((pw) => pw.status === "completed").length;
    const totalNonRest = weekWorkouts.filter((pw) => pw.workout_type !== "rest").length;
    const compliance = totalNonRest > 0 ? Math.round((completedNonRest / totalNonRest) * 100) : 0;

    return {
      name: t("weekShort", { n: w.week_number }),
      planned: w.target_km,
      actual: Math.round(actualKm * 10) / 10,
      compliance,
    };
  });

  // Determine current week index based on today
  const today = new Date().toISOString().split("T")[0];
  const currentWeekIdx = weeks.findIndex((w) => {
    if (w.workouts.length === 0) return false;
    const firstDate = w.workouts[0].date;
    const lastDate = w.workouts[w.workouts.length - 1].date;
    return today >= firstDate && today <= lastDate;
  });

  return (
    <div className={`${PANEL_CLASS} rounded-2xl p-4`}>
      <h3 className="text-sm font-medium text-slate-300 mb-3">{t("title")}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "0.75rem" }}
            labelStyle={{ color: "#e2e8f0" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={((value: any, name: any) => [
              `${value ?? 0} km`,
              name === "planned" ? t("planned") : t("actual"),
            ]) as never}
          />
          <Legend
            formatter={(value: string) => (value === "planned" ? t("planned") : t("actual"))}
            wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          />
          <Bar dataKey="planned" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.6} />
          <Bar dataKey="actual" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {currentWeekIdx >= 0 && data[currentWeekIdx] && (
        <p className="text-xs text-slate-500 mt-2 text-center">
          {t("currentWeek", {
            actual: data[currentWeekIdx].actual,
            planned: data[currentWeekIdx].planned,
            pct: data[currentWeekIdx].compliance,
          })}
        </p>
      )}
    </div>
  );
}
