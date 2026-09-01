"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { KpiCard } from "./KpiCard";
import { IntradayChart } from "./IntradayChart";
import { ActivityList } from "./ActivityList";

type MergedDay = {
  steps: number | null;
  floors: number | null;
  intensityMinutes: number | null;
  caloriesTotal: number | null;
  caloriesActive: number | null;
  restingHr: number | null;
  stressAvg: number | null;
  stressMax: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  spo2Avg: number | null;
  respirationAvg: number | null;
  hrvMs: number | null;
  hrvStatus: string | null;
  hydrationMl: number | null;
  providers: string[];
} | null;

type SleepRow = {
  totalMin: number | null;
  score: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  isNap: boolean;
};

type ScoreRow = { provider: string; scores: Record<string, unknown> };

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatSleep(min: number | null): string {
  if (min == null) return "—";
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function TodayView() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [day, setDay] = useState<MergedDay>(null);
  const [sleep, setSleep] = useState<SleepRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/health/daily?date=${d}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setDay(json.day);
      setSleep(json.sleep ?? []);
      setScores(json.scores ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(isoDay(d));
  };

  const night = useMemo(() => sleep.find((s) => !s.isNap) ?? null, [sleep]);
  const today = isoDay(new Date());

  const kpis = day
    ? ([
        { key: "steps", value: day.steps?.toLocaleString() },
        { key: "sleep", value: night ? formatSleep(night.totalMin) : undefined, sub: night?.score != null ? `${night.score}/100` : undefined },
        { key: "restingHr", value: day.restingHr != null ? `${day.restingHr} bpm` : undefined },
        { key: "stress", value: day.stressAvg != null ? `${day.stressAvg}` : undefined, sub: day.stressMax != null ? `max ${day.stressMax}` : undefined },
        { key: "bodyBattery", value: day.bodyBatteryHigh != null ? `${day.bodyBatteryLow ?? "?"}–${day.bodyBatteryHigh}` : undefined },
        { key: "calories", value: day.caloriesTotal?.toLocaleString(), sub: day.caloriesActive != null ? `${day.caloriesActive} act` : undefined },
        { key: "spo2", value: day.spo2Avg != null ? `${day.spo2Avg}%` : undefined },
        { key: "respiration", value: day.respirationAvg != null ? `${day.respirationAvg} rpm` : undefined },
        { key: "hrv", value: day.hrvMs != null ? `${day.hrvMs} ms` : undefined, sub: day.hrvStatus ?? undefined },
        { key: "hydration", value: day.hydrationMl != null ? `${day.hydrationMl} ml` : undefined },
        { key: "floors", value: day.floors != null ? `${day.floors}` : undefined },
        { key: "intensityMinutes", value: day.intensityMinutes != null ? `${day.intensityMinutes} min` : undefined },
      ] as const)
    : [];

  const visibleKpis = kpis.filter((k) => k.value != null && k.value !== "");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => shiftDay(-1)} aria-label="previous day" className="rounded-md border border-zinc-700 px-2.5 py-1 hover:bg-zinc-800">←</button>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        />
        <button onClick={() => shiftDay(1)} disabled={date >= today} aria-label="next day" className="rounded-md border border-zinc-700 px-2.5 py-1 hover:bg-zinc-800 disabled:opacity-40">→</button>
        {date !== today ? (
          <button onClick={() => setDate(today)} className="rounded-md px-2 py-1 text-sm text-emerald-400 hover:underline">
            {t("today")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{tCommon("error")}</p> : null}
      {loading ? <p className="text-sm text-zinc-500">{tCommon("loading")}</p> : null}

      {!loading && !error && visibleKpis.length === 0 ? (
        <p className="text-sm text-zinc-400">{t("comingSoon")}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visibleKpis.map((k) => (
          <KpiCard key={k.key} label={t(`kpi.${k.key}`)} value={k.value!} sub={"sub" in k ? k.sub : undefined} />
        ))}
        {scores.map((s) =>
          Object.entries(s.scores)
            .filter(([, v]) => typeof v === "number" || typeof v === "string")
            .map(([name, v]) => (
              <KpiCard key={`${s.provider}-${name}`} label={name} value={String(v)} sub={s.provider} />
            )),
        )}
      </div>

      <IntradayChart date={date} />
      <ActivityList date={date} />
    </div>
  );
}
