"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { RebalanceProposal } from "@/lib/training/rebalance";

interface RebalanceBannerProps {
  proposal: RebalanceProposal;
  onApply: () => Promise<void>;
  onDismiss: () => Promise<void>;
}

export default function RebalanceBanner({ proposal, onApply, onDismiss }: RebalanceBannerProps) {
  const t = useTranslations("training.week.rebalance");
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: "apply" | "dismiss", fn: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  };

  const isDeficit = proposal.deltaKm > 0;

  return (
    <div
      className={`rounded-xl px-3 py-2.5 border text-[12px] ${
        isDeficit
          ? "bg-amber-500/10 border-amber-500/30"
          : "bg-sky-500/10 border-sky-500/30"
      }`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <span className="shrink-0">&#9878;&#65039;</span>
        <p className={`flex-1 min-w-[180px] ${isDeficit ? "text-amber-300" : "text-sky-300"}`}>
          {proposal.summary}
          {proposal.discardedKm > 0 && (
            <span className="text-slate-500">{t("discarded", { km: proposal.discardedKm })}</span>
          )}
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => run("apply", onApply)}
            disabled={busy !== null}
            className="press px-3 py-1 rounded-lg text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white transition-all disabled:opacity-50"
          >
            {busy === "apply" ? t("applying") : t("apply")}
          </button>
          <button
            onClick={() => run("dismiss", onDismiss)}
            disabled={busy !== null}
            className="px-3 py-1 rounded-lg text-[11px] text-slate-400 border border-slate-700 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {busy === "dismiss" ? t("dismissing") : t("dismiss")}
          </button>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
