import { useTranslations } from "next-intl";

export default function TrainingPage() {
  // Placeholder until Fase 6 (full Training port).
  return <TrainingEmpty />;
}

function TrainingEmpty() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t("training")}</h1>
      <p className="text-sm text-zinc-400">{tCommon("featureDisabled")}</p>
    </div>
  );
}
