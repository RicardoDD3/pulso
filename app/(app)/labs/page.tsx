import { useTranslations } from "next-intl";

export default function LabsPage() {
  // Placeholder until Fase 5 (labs extraction).
  return <LabsEmpty />;
}

function LabsEmpty() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t("labs")}</h1>
      <p className="text-sm text-zinc-400">{tCommon("featureDisabled")}</p>
    </div>
  );
}
