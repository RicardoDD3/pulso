import { useTranslations } from "next-intl";
import { getFeatures } from "@/lib/system/features";
import { CoachView } from "@/components/coach/CoachView";

export default function CoachPage() {
  const features = getFeatures();
  if (!features.chatEnabled) return <CoachDisabled />;
  return <CoachView />;
}

function CoachDisabled() {
  const t = useTranslations("coach");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="max-w-md text-sm text-zinc-400">{t("disabledHint")}</p>
    </div>
  );
}
