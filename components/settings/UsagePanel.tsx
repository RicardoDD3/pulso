"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type UsageRow = {
  model: string;
  feature: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  calls: number;
};

type Usage = {
  last30Days: UsageRow[];
  today: { tokens: number; limit: number | null };
};

export function UsagePanel() {
  const t = useTranslations("usage");
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/settings/usage")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  if (!usage || usage.last30Days.length === 0) return null;

  const totalCost = usage.last30Days.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);
  const pct =
    usage.today.limit != null
      ? Math.min(100, Math.round((usage.today.tokens / usage.today.limit) * 100))
      : null;

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-semibold text-zinc-300">{t("title")}</h2>
      {pct != null ? (
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{t("todayQuota")}</span>
            <span className="tabular-nums">
              {usage.today.tokens.toLocaleString()} / {usage.today.limit?.toLocaleString()} ({pct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full ${pct > 90 ? "bg-red-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">
        {t("monthEstimate")}: <span className="font-semibold text-zinc-300">${totalCost.toFixed(2)} USD</span>
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-zinc-500">
          <tr className="text-left">
            <th className="py-1 pr-2">{t("model")}</th>
            <th className="py-1 pr-2">{t("feature")}</th>
            <th className="py-1 pr-2 text-right">{t("calls")}</th>
            <th className="py-1 pr-2 text-right">in</th>
            <th className="py-1 pr-2 text-right">out</th>
            <th className="py-1 text-right">$</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {usage.last30Days.map((r) => (
            <tr key={`${r.model}-${r.feature}`} className="border-t border-zinc-800/60">
              <td className="py-1 pr-2">{r.model}</td>
              <td className="py-1 pr-2">{r.feature}</td>
              <td className="py-1 pr-2 text-right">{r.calls}</td>
              <td className="py-1 pr-2 text-right">{Number(r.tokensIn).toLocaleString()}</td>
              <td className="py-1 pr-2 text-right">{Number(r.tokensOut).toLocaleString()}</td>
              <td className="py-1 text-right">{Number(r.costUsd ?? 0).toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
