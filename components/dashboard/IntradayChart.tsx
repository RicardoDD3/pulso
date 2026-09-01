"use client";

import { useEffect, useState } from "react";
import { useViewAs } from "@/lib/hooks/use-view-as";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Sample = { recordedAt: string; value: number };

const SERIES = [
  { metric: "hr", label: "HR", color: "#f87171" },
  { metric: "body_battery", label: "Body Battery", color: "#34d399" },
  { metric: "stress", label: "Stress", color: "#fbbf24" },
] as const;

export function IntradayChart({ date }: { date: string }) {
  const [series, setSeries] = useState<Record<string, Sample[]>>({});
  const { qs } = useViewAs();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results: Record<string, Sample[]> = {};
      await Promise.all(
        SERIES.map(async ({ metric }) => {
          try {
            const res = await fetch(qs(`/api/health/samples?date=${date}&metric=${metric}`));
            if (res.ok) results[metric] = (await res.json()).samples;
          } catch {
            /* series simply not shown */
          }
        }),
      );
      if (!cancelled) setSeries(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, qs]);

  const populated = SERIES.filter(({ metric }) => (series[metric]?.length ?? 0) > 0);
  if (populated.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {populated.map(({ metric, label, color }) => (
        <div key={metric} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart
              data={series[metric].map((s) => ({
                t: new Date(s.recordedAt).getHours() + new Date(s.recordedAt).getMinutes() / 60,
                v: s.value,
              }))}
            >
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, 24]}
                ticks={[0, 6, 12, 18, 24]}
                tickFormatter={(v: number) => `${v}h`}
                stroke="#52525b"
                fontSize={10}
              />
              <YAxis stroke="#52525b" fontSize={10} width={30} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
                labelFormatter={(label) => { const v = Number(label); return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`; }}
              />
              <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
