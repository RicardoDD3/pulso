"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useBackdropDismiss } from "@/lib/hooks/use-backdrop-dismiss";
import type { GeneratedDay, SessionType } from "@/lib/training/plan-generator-types";

interface DayEditModalProps {
  day: GeneratedDay;
  weekIndex: number;
  dayIndex: number;
  planId: string;
  onSave: () => void;
  onClose: () => void;
}

const SESSION_OPTIONS: SessionType[] = ["z2", "hiit", "long_run", "back_to_back"];

export default function DayEditModal({ day, weekIndex, dayIndex, planId, onSave, onClose }: DayEditModalProps) {
  const t = useTranslations("training.week.dayEdit");
  const [sessionType, setSessionType] = useState<SessionType>(day.sessionType);
  const [strengthDay, setStrengthDay] = useState(!!day.strengthDay);
  const [distanceKm, setDistanceKm] = useState(day.distanceKm);
  const [zone, setZone] = useState(day.zone);
  const [notes, setNotes] = useState(day.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRest = sessionType === "rest";
  const backdrop = useBackdropDismiss(onClose);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/plans/${planId}/day`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekIndex,
          dayIndex,
          updates: {
            sessionType,
            strengthDay,
            distanceKm: isRest ? 0 : distanceKm,
            zone: isRest ? "" : zone,
            notes: isRest ? "" : notes,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || t("saveError"));
      }
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" {...backdrop}>
      <div className="glass-panel rounded-2xl bg-slate-900 border border-slate-700 p-5 w-full max-w-sm space-y-4 pb-safe" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">
            {day.dayLabel} — {day.date}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">&times;</button>
        </div>

        {/* Session type */}
        <div>
          <label className="text-[11px] text-slate-400 uppercase tracking-wider block mb-1">{t("sessionType")}</label>
          <select
            value={sessionType}
            onChange={(e) => setSessionType(e.target.value as SessionType)}
            className="w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-green-500 outline-none"
          >
            {SESSION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{t(opt)}</option>
            ))}
          </select>
        </div>

        {/* Distance (hidden for rest) */}
        {!isRest && (
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider block mb-1">{t("distance")}</label>
            <input
              type="number"
              value={distanceKm}
              onChange={(e) => setDistanceKm(Number(e.target.value))}
              step="0.5"
              min="0"
              className="w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-green-500 outline-none"
            />
          </div>
        )}

        {/* Zone */}
        {!isRest && (
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider block mb-1">{t("zone")}</label>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-green-500 outline-none"
            />
          </div>
        )}

        {/* Notes */}
        {!isRest && (
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider block mb-1">{t("notes")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-green-500 outline-none resize-none"
            />
          </div>
        )}

        {/* Strength day (independiente de la corrida) */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={strengthDay}
            onChange={(e) => setStrengthDay(e.target.checked)}
            className="accent-indigo-500 w-4 h-4"
          />
          <span className="text-sm text-slate-300">{t("strengthDay")}</span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-slate-400 border border-slate-700 rounded-xl hover:bg-slate-800 transition-all"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="press flex-1 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-all disabled:opacity-50"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
