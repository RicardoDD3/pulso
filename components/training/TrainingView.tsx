"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PlanGeneratorForm } from "./PlanGeneratorForm";
import { PlanView } from "./PlanView";
import type { PlanSummary } from "./types";

type Props = {
  aiPlansEnabled: boolean;
  chatEnabled: boolean;
};

export function TrainingView({ aiPlansEnabled, chatEnabled }: Props) {
  const t = useTranslations("training");
  const tCommon = useTranslations("common");
  const [tab, setTab] = useState<"plan" | "history">("plan");
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [historyPlanId, setHistoryPlanId] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/training/plans");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPlans(json.plans ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const active = plans?.find((p) => p.status === "active") ?? null;
  const past = (plans ?? []).filter((p) => p.status !== "active");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {(["plan", "history"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === key
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {key === "plan" ? t("tabPlan") : t("tabHistory")}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{tCommon("error")}</p> : null}

      {tab === "plan" ? (
        plans === null ? (
          <p className="text-sm text-zinc-500">{tCommon("loading")}</p>
        ) : active ? (
          <PlanView
            planId={active.id}
            chatEnabled={chatEnabled}
            onPlanChanged={loadPlans}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">{t("noPlanTitle")}</p>
            <PlanGeneratorForm aiPlansEnabled={aiPlansEnabled} onCreated={loadPlans} />
          </div>
        )
      ) : historyPlanId ? (
        <div className="space-y-3">
          <button
            onClick={() => setHistoryPlanId(null)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            ‹ {t("history.back")}
          </button>
          <PlanView planId={historyPlanId} readOnly />
        </div>
      ) : (
        <HistoryList plans={past} onOpen={setHistoryPlanId} />
      )}
    </div>
  );
}

function HistoryList({
  plans,
  onOpen,
}: {
  plans: PlanSummary[];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("training");
  if (plans.length === 0) {
    return <p className="text-sm text-zinc-500">{t("history.empty")}</p>;
  }
  return (
    <ul className="space-y-2">
      {plans.map((p) => (
        <li key={p.id}>
          <button
            onClick={() => onOpen(p.id)}
            className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-700"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-zinc-100">
                {p.name}
              </span>
              <span className="block text-xs text-zinc-500">
                {t("history.created")} {p.createdAt.slice(0, 10)}
                {p.goalDate ? ` · ${p.goalDate}` : ""}
              </span>
            </span>
            <span
              className={`ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
                p.status === "completed"
                  ? "bg-emerald-900/50 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {t(`plan.status.${p.status === "completed" ? "completed" : p.status === "abandoned" ? "abandoned" : "active"}`)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
