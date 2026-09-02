"use client";

// QuickLogModal — registro rápido desde la vista de semana (doble click en un
// box). Modo "strength": sets de pesas del día (exercise_sets). Modo
// "bodyweight": reps diarias de ejercicios de cuerpo (exercise_logs, upsert).
// El padre refresca los datos de la semana al cerrar.

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useBackdropDismiss } from "@/lib/hooks/use-backdrop-dismiss";
import type { ExerciseDefLite } from "@/lib/training/week-tracks";
import {
  DEFAULT_SETS,
  DEFAULT_REPS,
  parseSetEntry,
  formatAddSetsLabel,
} from "@/lib/training/quick-log";

interface SetRow {
  setNumber: number;
  weightKg: number;
  reps: number;
}

interface QuickLogModalProps {
  date: string;
  dayLabel: string;
  mode: "strength" | "bodyweight";
  defs: ExerciseDefLite[];
  onClose: () => void;
}

const PANEL_CLASS =
  "rounded-2xl bg-slate-900 border border-slate-700 p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto";

export default function QuickLogModal({ date, dayLabel, mode, defs, onClose }: QuickLogModalProps) {
  const t = useTranslations("training.week");
  const activeDefs = defs.filter(
    (d) => d.is_active && d.type === (mode === "strength" ? "weighted" : "bodyweight")
  );
  const backdrop = useBackdropDismiss(onClose);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" {...backdrop}>
      <div className={PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">
            {mode === "strength" ? t("quickLog.weights") : t("exercisesLabel")} — {dayLabel} {date}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">&times;</button>
        </div>

        {activeDefs.length === 0 ? (
          <p className="text-xs text-slate-500">{t("quickLog.emptyCatalog")}</p>
        ) : mode === "strength" ? (
          <StrengthLog date={date} defs={activeDefs} />
        ) : (
          <BodyweightLog date={date} defs={activeDefs} />
        )}

        <button
          onClick={onClose}
          className="w-full px-4 py-2 text-sm text-slate-400 border border-slate-700 rounded-xl hover:bg-slate-800 transition-all"
        >
          {t("quickLog.close")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pesas: sets del día                                                 */
/* ------------------------------------------------------------------ */

const INPUT_CLASS =
  "w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-indigo-500 outline-none";

function StrengthLog({ date, defs }: { date: string; defs: ExerciseDefLite[] }) {
  const t = useTranslations("training.week.quickLog");
  const [sets, setSets] = useState<Record<string, SetRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exercise, setExercise] = useState(defs[0]?.exercise_key || "");
  const [weight, setWeight] = useState("");
  const [setCount, setSetCount] = useState(String(DEFAULT_SETS));
  const [reps, setReps] = useState(String(DEFAULT_REPS));

  const fetchSets = useCallback(async () => {
    try {
      const res = await fetch(`/api/exercises/sets?date=${date}`);
      const data = await res.json();
      const grouped: Record<string, SetRow[]> = {};
      for (const s of data.sets || []) {
        (grouped[s.exerciseKey] ||= []).push({
          setNumber: s.setNumber,
          weightKg: s.weightKg,
          reps: s.reps,
        });
      }
      setSets(grouped);
    } catch {
      /* se muestra vacío */
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  // Al cambiar de ejercicio, precarga el peso del último set registrado
  useEffect(() => {
    const last = sets[exercise]?.at(-1);
    if (last) setWeight(String(last.weightKg));
  }, [exercise, sets]);

  // Guarda N sets iguales (peso × reps). Van uno por uno y en serie porque el
  // route auto-incrementa set_number a partir de lo ya guardado; si uno falla
  // (p. ej. tope de 20 sets) se detiene ahí y los anteriores quedan.
  const addSets = async () => {
    const parsed = parseSetEntry({ weight, sets: setCount, reps });
    if (!exercise) return;
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (let i = 0; i < parsed.sets; i++) {
        const res = await fetch("/api/exercises/sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, exerciseKey: exercise, weightKg: parsed.weightKg, reps: parsed.reps }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error?.message || t("saveError"));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      await fetchSets();
      setSaving(false);
    }
  };

  const removeLastSet = async (key: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/exercises/sets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, exerciseKey: key }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("deleteError"));
      }
      await fetchSets();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-xs text-slate-500">{t("loading")}</p>;

  return (
    <div className="space-y-3">
      {/* Sets registrados */}
      {defs.filter((d) => (sets[d.exercise_key] || []).length > 0).map((d) => (
        <div key={d.exercise_key} className="bg-slate-800/40 rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-200 font-medium">
              {d.emoji} {d.label}
            </span>
            <button
              onClick={() => removeLastSet(d.exercise_key)}
              disabled={saving}
              className="text-red-400 text-xs hover:text-red-300 disabled:opacity-50"
              title={t("removeLastSet")}
            >
              {t("minusSet")}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap mt-1.5">
            {(sets[d.exercise_key] || []).map((s) => (
              <span key={s.setNumber} className="text-[11px] text-slate-400 bg-slate-800/60 rounded px-1.5 py-0.5">
                {s.weightKg}lb&times;{s.reps}
              </span>
            ))}
          </div>
        </div>
      ))}

      {/* Agregar sets (default 3 × 5) */}
      <div className="border-t border-slate-700/40 pt-3 space-y-2">
        <select
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          className="w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-indigo-500 outline-none"
        >
          {defs.map((d) => (
            <option key={d.exercise_key} value={d.exercise_key}>
              {d.emoji} {d.label}
            </option>
          ))}
        </select>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor="quicklog-weight" className="text-[10px] text-slate-500 uppercase block mb-0.5">
              {t("weightLb")}
            </label>
            <input
              id="quicklog-weight"
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSets(); }}
              className={INPUT_CLASS}
            />
          </div>
          <div className="w-16 shrink-0">
            <label htmlFor="quicklog-sets" className="text-[10px] text-slate-500 uppercase block mb-0.5">
              {t("sets")}
            </label>
            <input
              id="quicklog-sets"
              type="number"
              inputMode="numeric"
              min={1}
              value={setCount}
              onChange={(e) => setSetCount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSets(); }}
              className={INPUT_CLASS}
            />
          </div>
          <div className="w-16 shrink-0">
            <label htmlFor="quicklog-reps" className="text-[10px] text-slate-500 uppercase block mb-0.5">
              {t("reps")}
            </label>
            <input
              id="quicklog-reps"
              type="number"
              inputMode="numeric"
              min={1}
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSets(); }}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <button
          onClick={addSets}
          disabled={saving}
          className="press w-full px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-all disabled:opacity-50"
        >
          {saving ? t("saving") : formatAddSetsLabel(setCount, reps)}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cuerpo: reps diarias                                                */
/* ------------------------------------------------------------------ */

function BodyweightLog({ date, defs }: { date: string; defs: ExerciseDefLite[] }) {
  const t = useTranslations("training.week.quickLog");
  const [reps, setReps] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/exercises/logs?date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, number> = {};
        for (const row of data.logs || []) map[row.exerciseKey] = row.reps;
        setReps(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  const save = async (key: string, value: number) => {
    const clamped = Math.max(0, value);
    const prev = reps[key] || 0;
    setReps((r) => ({ ...r, [key]: clamped }));
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/exercises/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, exerciseKey: key, reps: clamped }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("saveError"));
      }
    } catch (e) {
      setReps((r) => ({ ...r, [key]: prev }));
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="text-xs text-slate-500">{t("loading")}</p>;

  return (
    <div className="space-y-2">
      {defs.map((d) => {
        const step = d.increment || 1;
        const value = reps[d.exercise_key] || 0;
        return (
          <div key={d.exercise_key} className="flex items-center gap-2 bg-slate-800/40 rounded-xl p-2.5">
            <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">
              {d.emoji} {d.label}
            </span>
            <button
              onClick={() => save(d.exercise_key, value - step)}
              disabled={saving === d.exercise_key || value === 0}
              className="w-8 h-8 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 text-lg font-bold flex items-center justify-center transition-all disabled:opacity-30"
            >
              &minus;
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={value}
              onChange={(e) => setReps((r) => ({ ...r, [d.exercise_key]: parseInt(e.target.value, 10) || 0 }))}
              onBlur={(e) => save(d.exercise_key, parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(d.exercise_key, parseInt((e.target as HTMLInputElement).value, 10) || 0);
              }}
              className="w-16 bg-slate-800 text-slate-200 text-sm text-center rounded-lg px-2 py-1.5 border border-slate-700 focus:border-teal-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => save(d.exercise_key, value + step)}
              disabled={saving === d.exercise_key}
              className="w-8 h-8 rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-700 text-lg font-bold flex items-center justify-center transition-all disabled:opacity-30"
            >
              +
            </button>
          </div>
        );
      })}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
