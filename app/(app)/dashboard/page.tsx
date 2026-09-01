"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TodayView } from "@/components/dashboard/TodayView";
import { TrendsView } from "@/components/dashboard/TrendsView";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const [tab, setTab] = useState<"today" | "trends">("today");
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-zinc-800 pb-2">
        {(["today", "trends"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === key ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {tab === "today" ? <TodayView /> : <TrendsView />}
    </div>
  );
}
