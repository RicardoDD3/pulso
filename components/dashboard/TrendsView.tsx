"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useViewAs } from "@/lib/hooks/use-view-as";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Daily = {
  date: string;
  steps: number | null;
  restingHr: number | null;
  stressAvg: number | null;
  bodyBatteryHigh: number | null;
  hrvMs: number | null;
};

type TrendsPayload = {
  daily: Daily[];
  sleep: { date: string; totalMin: number | null; score: number | null; isNap: boolean }[];
  body: { date: string; weightKg: number | null }[];
  effort: {
    trainingEffect: { date: string }[];
    trainingLoad: { date: string }[];
    gap: { date: string }[];
  };
};

const RANGES = [7, 30, 90] as const;

function TrendChart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  color: string;
}) {
  const points = data.filter((d) => d[dataKey] != null);
  if (points.length < 2) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{title}</p>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={points}>
          <XAxis
            dataKey="date"
            stroke="#52525b"
            fontSize={10}
            tickFormatter={(v: string) => v.slice(5)}
            minTickGap={30}
          />
          <YAxis stroke="#52525b" fontSize={10} width={38} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendsView() {
  const t = useTranslations("trends");
  const tCommon = useTranslations("common");
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<TrendsPayload | null>(null);
  const [error, setError] = useState(false);
  const { qs } = useViewAs();

  useEffect(() => {
    setData(null);
    fetch(qs(`/api/health/trends?days=${days}`))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [days, qs]);

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;

  const sleepData =
    data?.sleep.filter((s) => !s.isNap).map((s) => ({ ...s, totalH: s.totalMin != null ? Math.round((s.totalMin / 60) * 10) / 10 : null })) ?? [];
  const hasEffort =
    (data?.effort.trainingEffect.length ?? 0) > 1 || (data?.effort.trainingLoad.length ?? 0) > 1;

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setDays(r)}
            className={`rounded-md px-3 py-1 text-sm ${
              days === r ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {r}d
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-sm text-zinc-500">{tCommon("loading")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TrendChart title={t("steps")} data={data.daily} dataKey="steps" color="#34d399" />
          <TrendChart title={t("sleep")} data={sleepData} dataKey="totalH" color="#818cf8" />
          <TrendChart title={t("sleepScore")} data={sleepData} dataKey="score" color="#a78bfa" />
          <TrendChart title={t("restingHr")} data={data.daily} dataKey="restingHr" color="#f87171" />
          <TrendChart title={t("stress")} data={data.daily} dataKey="stressAvg" color="#fbbf24" />
          <TrendChart title={t("hrv")} data={data.daily} dataKey="hrvMs" color="#22d3ee" />
          <TrendChart title={t("weight")} data={data.body} dataKey="weightKg" color="#f472b6" />
          <TrendChart
            title={t("bodyBattery")}
            data={data.daily}
            dataKey="bodyBatteryHigh"
            color="#4ade80"
          />
        </div>
      )}

      {data && !hasEffort ? <p className="text-xs text-zinc-600">{t("effortHint")}</p> : null}
    </div>
  );
}
