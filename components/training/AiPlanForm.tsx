"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { postPlan, fieldClass as field, labelClass as label } from "./create-plan";

const GOAL_TYPES = ["marathon", "ultra", "half_marathon", "10k", "general"] as const;
const TERRAINS = ["road", "trail", "mixed"] as const;

type Props = { onCreated: () => void };

/** AI plan generation form — rendered only when aiPlansEnabled. */
export function AiPlanForm({ onCreated }: Props) {
  const t = useTranslations("training.generator");
  const tCommon = useTranslations("common");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState("marathon");
  const [goalDate, setGoalDate] = useState("");
  const [goalTime, setGoalTime] = useState("");
  const [goalDistance, setGoalDistance] = useState("");
  const [availableDays, setAvailableDays] = useState(5);
  const [terrain, setTerrain] = useState("trail");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await postPlan(
      {
        generator: "ai",
        name: name.trim(),
        goal_type: goalType,
        goal_date: goalDate,
        ...(goalTime.trim() ? { goal_time: goalTime.trim() } : {}),
        ...(goalDistance ? { goal_distance_km: Number(goalDistance) } : {}),
        available_days: availableDays,
        terrain,
      },
      tCommon("error"),
    );
    setSubmitting(false);
    if (err) setError(err);
    else onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor="ai-name" className={label}>
            {t("aiName")}
          </label>
          <input
            id="ai-name"
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="ai-goal-type" className={label}>
            {t("goalType")}
          </label>
          <select
            id="ai-goal-type"
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className={`mt-1 ${field}`}
          >
            {GOAL_TYPES.map((g) => (
              <option key={g} value={g}>
                {t(`goalTypes.${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ai-race-date" className={label}>
            {t("raceDate")}
          </label>
          <input
            id="ai-race-date"
            type="date"
            required
            value={goalDate}
            onChange={(e) => setGoalDate(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="ai-goal-time" className={label}>
            {t("goalTime")}
          </label>
          <input
            id="ai-goal-time"
            type="text"
            maxLength={40}
            value={goalTime}
            onChange={(e) => setGoalTime(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="ai-distance" className={label}>
            {t("goalDistanceKm")}
          </label>
          <input
            id="ai-distance"
            type="number"
            min={1}
            max={500}
            step="0.1"
            value={goalDistance}
            onChange={(e) => setGoalDistance(e.target.value)}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="ai-days" className={label}>
            {t("availableDays")}
          </label>
          <input
            id="ai-days"
            type="number"
            min={1}
            max={7}
            required
            value={availableDays}
            onChange={(e) => setAvailableDays(Number(e.target.value))}
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="ai-terrain" className={label}>
            {t("terrain")}
          </label>
          <select
            id="ai-terrain"
            value={terrain}
            onChange={(e) => setTerrain(e.target.value)}
            className={`mt-1 ${field}`}
          >
            {TERRAINS.map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
