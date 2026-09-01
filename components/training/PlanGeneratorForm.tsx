"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AiPlanForm } from "./AiPlanForm";
import { postPlan, fieldClass as field, labelClass as label } from "./create-plan";

const DISTANCE_PRESETS = [5, 10, 21.1, 42.2] as const;
/** The deterministic generator rejects races under 21 km (INPUT_CONSTRAINTS). */
const MIN_DETERMINISTIC_KM = 21;

type Props = {
  aiPlansEnabled: boolean;
  onCreated: () => void;
};

export function PlanGeneratorForm({ aiPlansEnabled, onCreated }: Props) {
  const t = useTranslations("training.generator");
  const tCommon = useTranslations("common");
  const [mode, setMode] = useState<"deterministic" | "ai">("deterministic");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<number | "custom">(42.2);
  const [customKm, setCustomKm] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [currentKm, setCurrentKm] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState<5 | 6 | 7>(6);
  const [experience, setExperience] = useState("intermediate");
  const [longRunDay, setLongRunDay] = useState("saturday");
  const [name, setName] = useState("");

  const raceDistanceKm = preset === "custom" ? Number(customKm) : preset;
  const tooShort =
    Number.isFinite(raceDistanceKm) && raceDistanceKm > 0 && raceDistanceKm < MIN_DETERMINISTIC_KM;

  async function submitDeterministic(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await postPlan(
      {
        generator: "deterministic",
        raceDistanceKm,
        raceDate,
        currentWeeklyKm: Number(currentKm),
        daysPerWeek,
        longRunDay,
        experienceLevel: experience,
        ...(name.trim() ? { name: name.trim() } : {}),
      },
      tCommon("error"),
    );
    setSubmitting(false);
    if (err) setError(err);
    else onCreated();
  }

  const presetBtn = (selected: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm ${
      selected
        ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
        : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
    }`;

  return (
    <div className="max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        {aiPlansEnabled ? (
          <div className="flex gap-1 rounded-lg border border-zinc-800 p-1">
            {(["deterministic", "ai"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-xs ${
                  mode === m ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {m === "deterministic" ? t("modeDeterministic") : t("modeAi")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {mode === "ai" ? (
        <AiPlanForm onCreated={onCreated} />
      ) : (
        <form onSubmit={submitDeterministic} className="space-y-3">
          <div>
            <span className={label}>{t("raceDistance")}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DISTANCE_PRESETS.map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => setPreset(km)}
                  className={presetBtn(preset === km)}
                >
                  {km} km
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset("custom")}
                className={presetBtn(preset === "custom")}
              >
                {t("customKm")}
              </button>
            </div>
            {preset === "custom" ? (
              <input
                type="number"
                min={21}
                max={500}
                step="0.1"
                required
                aria-label={t("customKm")}
                value={customKm}
                onChange={(e) => setCustomKm(e.target.value)}
                className={`mt-2 ${field}`}
              />
            ) : null}
            {tooShort ? (
              <p className="mt-1.5 text-xs text-amber-400">{t("minDistanceHint")}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gen-race-date" className={label}>
                {t("raceDate")}
              </label>
              <input
                id="gen-race-date"
                type="date"
                required
                value={raceDate}
                onChange={(e) => setRaceDate(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </div>
            <div>
              <label htmlFor="gen-current-km" className={label}>
                {t("currentWeeklyKm")}
              </label>
              <input
                id="gen-current-km"
                type="number"
                min={10}
                max={200}
                required
                value={currentKm}
                onChange={(e) => setCurrentKm(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </div>
            <div>
              <label htmlFor="gen-days" className={label}>
                {t("daysPerWeek")}
              </label>
              <select
                id="gen-days"
                value={daysPerWeek}
                onChange={(e) => setDaysPerWeek(Number(e.target.value) as 5 | 6 | 7)}
                className={`mt-1 ${field}`}
              >
                {[5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="gen-exp" className={label}>
                {t("experience")}
              </label>
              <select
                id="gen-exp"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                className={`mt-1 ${field}`}
              >
                {["beginner", "intermediate", "advanced"].map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {t(lvl)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="gen-long-run" className={label}>
                {t("longRunDay")}
              </label>
              <select
                id="gen-long-run"
                value={longRunDay}
                onChange={(e) => setLongRunDay(e.target.value)}
                className={`mt-1 ${field}`}
              >
                <option value="saturday">{t("saturday")}</option>
                <option value="sunday">{t("sunday")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="gen-name" className={label}>
                {t("planName")}
              </label>
              <input
                id="gen-name"
                type="text"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting || tooShort}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </form>
      )}
    </div>
  );
}
