"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SmartAlert, AlertSeverity, AlertType } from "@/lib/training/plan-insights";

interface SmartAlertsPanelProps {
  alerts: SmartAlert[];
}

const SEVERITY_BORDER: Record<AlertSeverity, string> = {
  info: "border-l-blue-400",
  warning: "border-l-amber-400",
  danger: "border-l-red-400",
};

const TYPE_ICON: Record<AlertType, string> = {
  missed: "📅",
  biomarker: "🧪",
  hr_trend: "❤️",
  low_battery: "🔋",
  compliance: "📊",
};

export default function SmartAlertsPanel({ alerts }: SmartAlertsPanelProps) {
  const t = useTranslations("training.insights.alerts");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.id));

  if (visibleAlerts.length === 0) return null;

  function handleDismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {visibleAlerts.map((alert) => (
        <div
          key={alert.id}
          className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-3 border-l-4 ${SEVERITY_BORDER[alert.severity]} flex items-start gap-3`}
        >
          {/* Icon */}
          <span className="text-base leading-none shrink-0 mt-0.5">
            {TYPE_ICON[alert.type]}
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200">{alert.title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{alert.body}</p>
          </div>

          {/* Dismiss button */}
          <button
            onClick={() => handleDismiss(alert.id)}
            className="text-slate-600 hover:text-slate-300 text-xs cursor-pointer shrink-0 transition-colors"
            aria-label={t("dismiss")}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
