import { useTranslations } from "next-intl";

export default function DashboardPage() {
  // Placeholder until Fase 2 (wearable ingestion + Today/Trends views).
  return <DashboardEmpty />;
}

function DashboardEmpty() {
  const t = useTranslations("dashboard");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-zinc-400">{t("comingSoon")}</p>
    </div>
  );
}
