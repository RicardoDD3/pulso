import { useTranslations } from "next-intl";

export default function CoachPage() {
  // Placeholder until Fase 4 (LLM layer + coach chat).
  return <CoachEmpty />;
}

function CoachEmpty() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t("coach")}</h1>
      <p className="text-sm text-zinc-400">{tCommon("featureDisabled")}</p>
    </div>
  );
}
