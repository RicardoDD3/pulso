"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  formatStepsCompact,
  type RunTotals,
  type StrengthStatus,
  type ExerciseTotal,
  type StepsTotals,
} from "@/lib/training/week-tracks";

interface WeekTotalsColumnProps {
  runTotals: RunTotals;
  strengthStatus: StrengthStatus;
  exerciseTotals: ExerciseTotal[];
  stepsTotals: StepsTotals;
  /** Guarda la meta semanal de un ejercicio (PATCH). */
  onGoalChange?: (exerciseKey: string, goal: number | null) => Promise<void>;
  /** Guarda la meta semanal de pasos (min/max, PATCH). */
  onStepsGoalChange?: (min: number, max: number) => Promise<void>;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function RunRow({ label, plannedKm, actualKm }: { label: string; plannedKm: number; actualKm: number }) {
  if (plannedKm === 0 && actualKm === 0) return null;
  const pct = plannedKm > 0 ? actualKm / plannedKm : 0;
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] text-slate-400 uppercase">{label}</span>
      <span className="text-[10px] font-medium text-slate-200">
        <span className={pct >= 1 ? "text-green-400" : actualKm > 0 ? "text-amber-400" : "text-slate-500"}>
          {fmt(actualKm)}
        </span>
        <span className="text-slate-600">/{fmt(plannedKm)}</span>
      </span>
    </div>
  );
}

function GoalEditor({
  total,
  onGoalChange,
}: {
  total: ExerciseTotal;
  onGoalChange?: (key: string, goal: number | null) => Promise<void>;
}) {
  const t = useTranslations("training.week.totals");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(total.goal != null ? String(total.goal) : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!onGoalChange) return;
    setSaving(true);
    try {
      const n = value.trim() === "" ? null : parseInt(value, 10);
      await onGoalChange(total.key, n != null && !isNaN(n) && n > 0 ? n : null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          autoFocus
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-12 bg-slate-800 text-slate-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 outline-none text-right"
        />
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] text-green-400 rounded px-1 py-0.5 hover:bg-green-500/20 transition-colors disabled:opacity-50"
          title={t("save")}
        >
          {saving ? "…" : "✓"}
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-[10px] text-slate-400 rounded px-1 py-0.5 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
          title={t("cancel")}
        >
          &#10005;
        </button>
      </div>
    );
  }

  const pct = total.goal ? total.reps / total.goal : 0;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (onGoalChange) setEditing(true);
      }}
      className="text-[10px] font-medium hover:brightness-125 transition-all"
      title={onGoalChange ? t("editWeeklyGoal") : undefined}
    >
      <span className={total.goal ? (pct >= 1 ? "text-green-400" : "text-amber-400") : "text-slate-300"}>
        {total.reps}
      </span>
      {total.goal != null ? (
        <span className="text-slate-600">/{total.goal}</span>
      ) : (
        <span className="text-slate-700"> {t("addGoal")}</span>
      )}
    </button>
  );
}

/** Editor de la meta semanal de pasos (min/max). Edita en miles: 150 = 150k. */
function StepsGoalEditor({
  totals,
  onStepsGoalChange,
}: {
  totals: StepsTotals;
  onStepsGoalChange?: (min: number, max: number) => Promise<void>;
}) {
  const t = useTranslations("training.week.totals");
  const tWeek = useTranslations("training.week");
  const [editing, setEditing] = useState(false);
  const [minK, setMinK] = useState(String(Math.round(totals.goalMin / 1000)));
  const [maxK, setMaxK] = useState(String(Math.round(totals.goalMax / 1000)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!onStepsGoalChange) return;
    const m = parseInt(minK, 10);
    const x = parseInt(maxK, 10);
    if (!Number.isFinite(m) || !Number.isFinite(x) || m <= 0 || x <= 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onStepsGoalChange(m * 1000, x * 1000);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div
        className="rounded-lg p-2 border border-sky-500/40 bg-sky-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] text-sky-300 uppercase font-medium block mb-1">
          &#128099; {tWeek("stepsLabel")}
        </span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            autoFocus
            value={minK}
            disabled={saving}
            onChange={(e) => setMinK(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-10 bg-slate-800 text-slate-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 outline-none text-right"
          />
          <span className="text-[10px] text-slate-500">&ndash;</span>
          <input
            type="number"
            value={maxK}
            disabled={saving}
            onChange={(e) => setMaxK(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-10 bg-slate-800 text-slate-200 text-[10px] rounded px-1 py-0.5 border border-slate-600 outline-none text-right"
          />
          <span className="text-[10px] text-slate-500">k</span>
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 text-[10px] font-medium bg-sky-500/30 text-sky-200 rounded px-2 py-1 hover:bg-sky-500/50 transition-colors disabled:opacity-50"
          >
            {saving ? t("saving") : t("saveSteps")}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="text-[10px] text-slate-400 rounded px-2 py-1 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
            title={t("cancel")}
          >
            &#10005;
          </button>
        </div>
      </div>
    );
  }

  const stepsHitMin = totals.total >= totals.goalMin;
  return (
    <div className="rounded-lg p-2 border border-slate-700/40 bg-sky-500/10">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] text-sky-300 uppercase font-medium">
          &#128099; {tWeek("stepsLabel")}
        </span>
        <span className="text-[10px] font-medium">
          <span className={stepsHitMin ? "text-green-400" : totals.total > 0 ? "text-amber-400" : "text-slate-500"}>
            {formatStepsCompact(totals.total)}
          </span>
          <span className="text-slate-600">/{formatStepsCompact(totals.goalMin)}</span>
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!onStepsGoalChange) return;
          setMinK(String(Math.round(totals.goalMin / 1000)));
          setMaxK(String(Math.round(totals.goalMax / 1000)));
          setEditing(true);
        }}
        className="text-[9px] text-slate-500 mt-0.5 hover:text-slate-300 transition-colors"
        title={onStepsGoalChange ? t("editStepsGoal") : undefined}
      >
        {t("stepsGoal", {
          min: formatStepsCompact(totals.goalMin),
          max: formatStepsCompact(totals.goalMax),
        })}
        {onStepsGoalChange && <span className="text-slate-600"> &#9998;</span>}
      </button>
    </div>
  );
}

export default function WeekTotalsColumn({
  runTotals,
  strengthStatus,
  exerciseTotals,
  stepsTotals,
  onGoalChange,
  onStepsGoalChange,
}: WeekTotalsColumnProps) {
  const t = useTranslations("training.week.totals");
  const tWeek = useTranslations("training.week");
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="px-0.5">
        <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
          {t("title")}
        </span>
      </div>

      {/* Corrida */}
      <div className="rounded-lg p-2 border border-slate-700/40 bg-slate-800/40 space-y-1">
        <RunRow label="HIIT" plannedKm={runTotals.hiit.plannedKm} actualKm={runTotals.hiit.actualKm} />
        <RunRow label="Z2" plannedKm={runTotals.z2.plannedKm} actualKm={runTotals.z2.actualKm} />
        <RunRow label={t("long")} plannedKm={runTotals.longRun.plannedKm} actualKm={runTotals.longRun.actualKm} />
        <div className="border-t border-slate-700/40 pt-1">
          <RunRow label={t("totalKm")} plannedKm={runTotals.total.plannedKm} actualKm={runTotals.total.actualKm} />
        </div>
      </div>

      {/* Pasos — editable */}
      <StepsGoalEditor totals={stepsTotals} onStepsGoalChange={onStepsGoalChange} />

      {/* Fuerza */}
      <div className="rounded-lg p-2 border border-slate-700/40 bg-indigo-500/10">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] text-indigo-300 uppercase font-medium">
            {tWeek("sessions.strength")}
          </span>
          <span className="text-[10px] font-medium">
            <span className={strengthStatus.doneCount >= strengthStatus.plannedCount && strengthStatus.plannedCount > 0 ? "text-green-400" : "text-slate-200"}>
              {strengthStatus.doneCount}
            </span>
            <span className="text-slate-600">/{strengthStatus.plannedCount}</span>
          </span>
        </div>
      </div>

      {/* Ejercicios (siempre visible: total semanal por ejercicio de cuerpo) */}
      <div className="rounded-lg p-2 border border-slate-700/40 bg-slate-800/40 space-y-1">
        <span className="text-[10px] text-teal-300 uppercase font-medium block">
          {tWeek("exercisesLabel")}
        </span>
        {exerciseTotals.length === 0 ? (
          <p className="text-[10px] text-slate-600">&mdash;</p>
        ) : (
          exerciseTotals.map((total) => (
            <div key={total.key} className="flex items-baseline justify-between gap-1">
              <span className="text-[10px] text-slate-400 truncate" title={total.label}>
                {total.emoji} {total.label}
              </span>
              <GoalEditor total={total} onGoalChange={onGoalChange} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
