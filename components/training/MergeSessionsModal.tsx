"use client";

import { useTranslations } from "next-intl";
import { useBackdropDismiss } from "@/lib/hooks/use-backdrop-dismiss";
import type { SectionMoveInfo } from "@/lib/training/week-tracks";

const SESSION_LABEL_KEYS = ["z2", "hiit", "long_run", "back_to_back", "strength", "rest"] as const;

interface MergeSessionsModalProps {
  info: SectionMoveInfo;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmación antes de FUNDIR dos sesiones del mismo tipo en un día.
 * La fusión no se deshace arrastrando de regreso (los km quedan en un solo
 * número): el único undo es el chat "Planes".
 */
export default function MergeSessionsModal({ info, onConfirm, onCancel }: MergeSessionsModalProps) {
  const t = useTranslations("training.week");
  const isStrength = info.section === "strength";
  const label = (SESSION_LABEL_KEYS as readonly string[]).includes(info.sessionType)
    ? t(`sessions.${info.sessionType}`)
    : info.sessionType;
  const backdrop = useBackdropDismiss(onCancel);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      {...backdrop}
    >
      <div
        className="rounded-2xl bg-slate-900 border border-slate-700 p-5 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-amber-300">
          &#9888;&#65038; {isStrength ? t("merge.strengthTitle") : t("merge.runTitle")}
        </h3>

        <p className="text-xs text-slate-300">
          {isStrength ? (
            <>
              {info.fromLabel} &rarr; {info.toLabel}
            </>
          ) : (
            <>
              {info.fromLabel} &middot; {label} {info.fromKm} km &nbsp;&rarr;&nbsp; {info.toLabel}{" "}
              &middot; {label} {info.targetKm} km
            </>
          )}
        </p>

        <p className="text-xs text-slate-400">
          {isStrength ? (
            <>
              {t("merge.strengthBefore", { day: info.toLabel })}
              <span className="text-slate-200">{t("merge.strengthLoss")}</span>.
            </>
          ) : (
            <>
              {t("merge.runResultBefore")}
              <span className="text-slate-200">{t("merge.runResult", { km: info.resultKm })}</span>.
            </>
          )}{" "}
          {t("merge.noUndo")}
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 text-xs rounded-lg border border-slate-700 text-slate-300 py-2 hover:text-white hover:border-slate-500 transition-colors"
          >
            {t("merge.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 text-xs font-medium rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 py-2 hover:bg-amber-500/30 transition-colors"
          >
            {t("merge.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
