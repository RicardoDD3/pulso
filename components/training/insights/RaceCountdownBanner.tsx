"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RaceCountdown } from "@/lib/training/plan-insights";
import { PHASE_COLORS } from "@/lib/training/plan-static-data";

interface RaceCountdownBannerProps {
  countdown: RaceCountdown;
  planName: string;
}

export default function RaceCountdownBanner({
  countdown,
  planName,
}: RaceCountdownBannerProps) {
  const t = useTranslations("training.insights.countdown");
  const locale = useLocale();
  const phaseColors = PHASE_COLORS[countdown.phase] ?? PHASE_COLORS.base;
  const phaseLabel =
    countdown.phase.charAt(0).toUpperCase() + countdown.phase.slice(1);

  // For multi-race plans, point at the next upcoming race by name.
  const targetLabel = countdown.targetRaceName ?? planName;
  const raceDateLabel = new Date(
    countdown.targetRaceDate + "T12:00:00"
  ).toLocaleDateString(locale === "es" ? "es-MX" : locale, { day: "numeric", month: "short" });

  return (
    <div className="rounded-2xl border border-green-500/20 bg-slate-900/60 p-5 backdrop-blur-md bg-gradient-to-br from-green-500/5 to-transparent">
      {/* Main countdown */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-4xl font-bold text-white tracking-tight">
          {t("days", { n: countdown.daysRemaining })}
        </span>
        <span className="text-sm text-slate-400">
          {t("for", { name: targetLabel })}
          <span className="text-slate-500"> &middot; {raceDateLabel}</span>
        </span>
      </div>

      {countdown.isIntermediateRace && (
        <div className="mb-3 -mt-1 text-xs text-green-400/80">
          {t("nextRace", { plan: planName })}
        </div>
      )}

      {/* Progreso de carreras de la temporada (planes multi-carrera) */}
      {countdown.racesTotal > 1 && (
        <div className="mb-3 -mt-1 text-xs text-slate-400">
          🏁 {t("racesProgress", { completed: countdown.racesCompleted, total: countdown.racesTotal })}
          {countdown.racesRemaining > 0 && (
            <span className="text-slate-500">
              {" "}&middot; {t("racesLeft", { names: countdown.remainingRaceNames.join(", ") })}
            </span>
          )}
        </div>
      )}

      {/* Week / Phase info */}
      <div className="flex items-center gap-2 mb-4 text-sm text-slate-400">
        <span>{t("weekOf", { current: countdown.currentWeek, total: countdown.totalWeeks })}</span>
        <span className="text-slate-600">&mdash;</span>
        <span>{t("phase")}</span>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${phaseColors.badge}`}
        >
          {phaseLabel}
        </span>
      </div>

      {/* Mini stat boxes */}
      <div className="grid grid-cols-3 gap-3">
        {/* VO2max */}
        <div className="rounded-lg bg-slate-800/50 p-3 text-center">
          <div className="text-lg font-bold text-white">
            {countdown.vo2maxLatest != null
              ? countdown.vo2maxLatest
              : "—"}
          </div>
          <div className="text-[10px] uppercase text-slate-500 tracking-wider">
            {t("vo2max")}
          </div>
        </div>

        {/* Longest run */}
        <div className="rounded-lg bg-slate-800/50 p-3 text-center">
          <div className="text-lg font-bold text-white">
            {countdown.longestRunKm} km
          </div>
          <div className="text-[10px] uppercase text-slate-500 tracking-wider">
            {t("longRunMax")}
          </div>
        </div>

        {/* Avg km/week */}
        <div className="rounded-lg bg-slate-800/50 p-3 text-center">
          <div className="text-lg font-bold text-white">
            {t("kmPerWeek", { n: countdown.avgKmLast4Weeks })}
          </div>
          <div className="text-[10px] uppercase text-slate-500 tracking-wider">
            {t("avg4w")}
          </div>
        </div>
      </div>
    </div>
  );
}
