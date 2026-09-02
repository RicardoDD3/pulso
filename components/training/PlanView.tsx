"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { WeekCard } from "./WeekCard";
import WeekBoard from "./WeekBoard";
import { StepsBox } from "./StepsBox";
import { PlannerChat } from "./PlannerChat";
import InsightsPanel from "./insights/InsightsPanel";
import { isEditablePlan } from "@/lib/training/plan-generator-types";
import {
  localISODate,
  weekTargetKm,
  type PlanRow,
  type PlanVersion,
  type PlanWorkoutRow,
} from "./types";

type Props = {
  planId: string;
  readOnly?: boolean;
  chatEnabled?: boolean;
  onPlanChanged?: () => void;
};

type Detail = { plan: PlanRow; workouts: PlanWorkoutRow[] };

/** Default to the week containing today; clamp to the plan's range. */
function currentWeekNumber(weekNumbers: number[], byWeek: Map<number, PlanWorkoutRow[]>): number {
  const today = localISODate();
  for (const n of weekNumbers) {
    const dates = (byWeek.get(n) ?? []).map((r) => r.date).filter(Boolean) as string[];
    if (dates.length && today <= dates.reduce((a, b) => (a > b ? a : b))) return n;
  }
  return weekNumbers[weekNumbers.length - 1] ?? 1;
}

export function PlanView({ planId, readOnly = false, chatEnabled = false, onPlanChanged }: Props) {
  const t = useTranslations("training");
  const tCommon = useTranslations("common");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [week, setWeek] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/training/plans/${planId}`);
      if (!res.ok) throw new Error();
      setDetail(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, [planId]);

  useEffect(() => {
    void (async () => {
      if (!readOnly) {
        // Auto-sync on view load (spec doc 09); failures don't block the view.
        try {
          await fetch(`/api/training/plans/${planId}/sync`, { method: "POST" });
        } catch {
          /* offline or locked — just render what we have */
        }
      }
      await load();
    })();
  }, [planId, readOnly, load]);

  const byWeek = useMemo(() => {
    const map = new Map<number, PlanWorkoutRow[]>();
    for (const row of detail?.workouts ?? []) {
      const list = map.get(row.weekNumber) ?? [];
      list.push(row);
      map.set(row.weekNumber, list);
    }
    return map;
  }, [detail]);
  const weekNumbers = useMemo(() => [...byWeek.keys()].sort((a, b) => a - b), [byWeek]);

  async function sync() {
    setSyncing(true);
    try {
      await fetch(`/api/training/plans/${planId}/sync`, { method: "POST" });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function toggleVersions() {
    const next = !showVersions;
    setShowVersions(next);
    if (next) {
      const res = await fetch(`/api/training/plans/${planId}/versions`);
      if (res.ok) setVersions((await res.json()).versions ?? []);
    }
  }

  async function restore(versionId: string) {
    const res = await fetch(`/api/training/plans/${planId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (res.ok) {
      setShowVersions(false);
      setVersions(null);
      await load();
    }
  }

  async function setStatus(status: "completed" | "abandoned") {
    const res = await fetch(`/api/training/plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await load();
      onPlanChanged?.();
    }
  }

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;
  if (!detail) return <p className="text-sm text-zinc-500">{tCommon("loading")}</p>;

  const { plan } = detail;
  const totalWeeks = weekNumbers.length;
  // Until the user navigates, default to the week containing today.
  const activeWeek = week ?? (totalWeeks > 0 ? currentWeekNumber(weekNumbers, byWeek) : 1);
  const weekIdx = weekNumbers.indexOf(activeWeek);
  const daysToRace = plan.goalDate
    ? Math.ceil((Date.parse(plan.goalDate) - Date.parse(localISODate())) / 86_400_000)
    : null;

  const btn =
    "rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">{plan.name}</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {plan.goalDate ?? ""}
                {daysToRace != null
                  ? ` · ${daysToRace >= 0 ? t("plan.daysToRace", { days: daysToRace }) : t("plan.raceDone")}`
                  : ""}
                {totalWeeks > 0
                  ? ` · ${t("plan.weekOf", { n: weekIdx + 1, total: totalWeeks })}`
                  : ""}
              </p>
            </div>
            {readOnly ? (
              <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
                {t(`plan.status.${plan.status === "completed" ? "completed" : plan.status === "abandoned" ? "abandoned" : "active"}`)}
              </span>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void sync()} disabled={syncing} className={btn}>
                  {syncing ? t("plan.syncing") : t("plan.sync")}
                </button>
                <button onClick={() => void toggleVersions()} className={btn}>
                  {t("plan.versions")}
                </button>
                <button onClick={() => void setStatus("completed")} className={btn}>
                  {t("plan.markCompleted")}
                </button>
                <button onClick={() => void setStatus("abandoned")} className={btn}>
                  {t("plan.abandon")}
                </button>
                {chatEnabled ? (
                  <button
                    onClick={() => setChatOpen((v) => !v)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500"
                  >
                    {t("chat.open")}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {showVersions ? (
            <div className="mt-3 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
              {versions === null ? (
                <p className="text-xs text-zinc-500">{tCommon("loading")}</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-zinc-500">{t("plan.noVersions")}</p>
              ) : (
                versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-zinc-400">
                      {v.label || v.id.slice(0, 8)} · {v.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                    <button
                      onClick={() => void restore(v.id)}
                      className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
                    >
                      {t("plan.restore")}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {totalWeeks > 0 ? (
          <>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setWeek(weekNumbers[Math.max(0, weekIdx - 1)])}
                disabled={weekIdx <= 0}
                aria-label="‹"
                className={btn}
              >
                ‹
              </button>
              <span className="text-sm font-medium text-zinc-200">
                {t("plan.weekOf", { n: weekIdx + 1, total: totalWeeks })}
              </span>
              <button
                onClick={() => setWeek(weekNumbers[Math.min(weekNumbers.length - 1, weekIdx + 1)])}
                disabled={weekIdx >= weekNumbers.length - 1}
                aria-label="›"
                className={btn}
              >
                ›
              </button>
            </div>
            {isEditablePlan(plan.planJson) ? (
              <WeekBoard
                plan={plan}
                weekNumber={activeWeek}
                workouts={detail.workouts}
                readOnly={readOnly}
                onPlanChanged={load}
              />
            ) : (
              <WeekCard
                rows={byWeek.get(activeWeek) ?? []}
                targetKm={weekTargetKm(plan.planJson, activeWeek)}
              />
            )}
          </>
        ) : null}

        <StepsBox />

        <InsightsPanel planId={planId} readOnly={readOnly} />
      </div>

      {chatOpen && !readOnly ? (
        <PlannerChat
          planId={planId}
          onPlanModified={() => void load()}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </div>
  );
}
