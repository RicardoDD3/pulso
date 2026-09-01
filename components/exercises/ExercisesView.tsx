"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type Definition = {
  id: string;
  exerciseKey: string;
  label: string;
  emoji: string | null;
  color: string | null;
  type: "bodyweight" | "weighted";
  increment: number | null;
  weeklyGoal: number | null;
  isActive: boolean;
};

type LogRow = { exerciseKey: string; reps: number; date: string };
type SetRow = { exerciseKey: string; setNumber: number; weightKg: number | null; reps: number };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function ExercisesView() {
  const t = useTranslations("exercises");
  const tCommon = useTranslations("common");
  const [defs, setDefs] = useState<Definition[] | null>(null);
  const [lastWeights, setLastWeights] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [error, setError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const date = useMemo(todayIso, []);

  const load = useCallback(async () => {
    try {
      const [defsRes, logsRes, setsRes] = await Promise.all([
        fetch("/api/exercises/definitions"),
        fetch(`/api/exercises/logs?date=${date}`),
        fetch(`/api/exercises/sets?date=${date}`),
      ]);
      if (!defsRes.ok || !logsRes.ok || !setsRes.ok) throw new Error("load failed");
      const defsJson = await defsRes.json();
      setDefs(defsJson.definitions);
      setLastWeights(defsJson.lastWeights ?? {});
      setLogs((await logsRes.json()).logs);
      setSets((await setsRes.json()).sets);
      setError(false);
    } catch {
      setError(true);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;
  if (!defs) return <p className="text-sm text-zinc-400">{tCommon("loading")}</p>;

  const active = defs.filter((d) => d.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500"
        >
          {t("addExercise")}
        </button>
      </div>

      {showAdd ? <AddExerciseForm onCreated={() => (setShowAdd(false), void load())} /> : null}

      {active.length === 0 ? (
        <p className="text-sm text-zinc-400">{t("emptyState")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((def) =>
            def.type === "bodyweight" ? (
              <BodyweightCard
                key={def.id}
                def={def}
                reps={logs.find((l) => l.exerciseKey === def.exerciseKey)?.reps ?? 0}
                date={date}
                onChanged={load}
              />
            ) : (
              <WeightedCard
                key={def.id}
                def={def}
                sets={sets.filter((s) => s.exerciseKey === def.exerciseKey)}
                lastWeight={lastWeights[def.exerciseKey]}
                date={date}
                onChanged={load}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function BodyweightCard({
  def,
  reps,
  date,
  onChanged,
}: {
  def: Definition;
  reps: number;
  date: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("exercises");
  const increment = def.increment ?? 1;

  async function logReps(next: number) {
    await fetch("/api/exercises/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, exerciseKey: def.exerciseKey, reps: Math.max(0, next) }),
    });
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {def.emoji} {def.label}
        </span>
        {def.weeklyGoal ? (
          <span className="text-xs text-zinc-500">
            {t("weeklyGoal")}: {def.weeklyGoal}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-3xl font-bold tabular-nums">{reps}</span>
        <div className="flex gap-2">
          <button
            onClick={() => logReps(reps - increment)}
            className="h-9 w-9 rounded-lg border border-zinc-700 text-lg hover:bg-zinc-800"
            aria-label={`-${increment}`}
          >
            −
          </button>
          <button
            onClick={() => logReps(reps + increment)}
            className="h-9 w-9 rounded-lg bg-emerald-600 text-lg font-bold hover:bg-emerald-500"
            aria-label={`+${increment}`}
          >
            +
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {t("today")} · ±{increment} {t("reps")}
      </p>
    </div>
  );
}

function WeightedCard({
  def,
  sets,
  lastWeight,
  date,
  onChanged,
}: {
  def: Definition;
  sets: SetRow[];
  lastWeight: number | undefined;
  date: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("exercises");
  const [weight, setWeight] = useState<string>(lastWeight != null ? String(lastWeight) : "");
  const [reps, setReps] = useState<string>("8");

  useEffect(() => {
    if (weight === "" && lastWeight != null) setWeight(String(lastWeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastWeight]);

  async function addSet() {
    const w = Number(weight);
    const r = Number(reps);
    if (!Number.isFinite(w) || !Number.isFinite(r) || r <= 0) return;
    await fetch("/api/exercises/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, exerciseKey: def.exerciseKey, weightKg: w, reps: r }),
    });
    await onChanged();
  }

  async function removeLastSet() {
    await fetch("/api/exercises/sets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, exerciseKey: def.exerciseKey }),
    });
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {def.emoji} {def.label}
        </span>
        <span className="text-xs text-zinc-500">
          {sets.length} {t("sets")}
        </span>
      </div>
      {sets.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
          {sets.map((s) => (
            <li key={s.setNumber} className="tabular-nums">
              #{s.setNumber} — {s.weightKg ?? 0} kg × {s.reps}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="mb-0.5 block text-[11px] text-zinc-500">{t("weight")}</span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex-1">
          <span className="mb-0.5 block text-[11px] text-zinc-500">{t("reps")}</span>
          <input
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={addSet}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500"
        >
          {t("addSet")}
        </button>
      </div>
      {sets.length > 0 ? (
        <button
          onClick={removeLastSet}
          className="mt-2 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          {t("removeLastSet")}
        </button>
      ) : null}
    </div>
  );
}

function AddExerciseForm({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("exercises");
  const tCommon = useTranslations("common");
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("💪");
  const [type, setType] = useState<"bodyweight" | "weighted">("bodyweight");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    await fetch("/api/exercises/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        emoji,
        color: "emerald",
        type,
        increment: type === "bodyweight" ? 5 : 5,
      }),
    });
    setPending(false);
    onCreated();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <label className="flex-1">
        <span className="mb-0.5 block text-[11px] text-zinc-500">{t("addExercise")}</span>
        <input
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        />
      </label>
      <input
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        className="w-14 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-sm"
        aria-label="emoji"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as "bodyweight" | "weighted")}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
      >
        <option value="bodyweight">bodyweight</option>
        <option value="weighted">weighted</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
      >
        {tCommon("confirm")}
      </button>
    </form>
  );
}
