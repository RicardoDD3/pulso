"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useViewAs } from "@/lib/hooks/use-view-as";

/** "Viewing: <athlete>" banner while reading shared data via a grant. */
export function ViewAsBanner() {
  const t = useTranslations("account");
  const { viewAs } = useViewAs();
  if (!viewAs) return null;
  return (
    <div className="mt-2 flex items-center justify-between rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2 text-sm text-sky-300">
      <span>
        {t("viewingAs")} {viewAs.slice(0, 8)}… · {t("readOnly")}
      </span>
      <Link href="/dashboard" className="text-xs underline underline-offset-2">
        {t("backToMine")}
      </Link>
    </div>
  );
}
