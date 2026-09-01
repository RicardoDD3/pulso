import { getFeatures } from "@/lib/system/features";
import { TrainingView } from "@/components/training/TrainingView";

export default function TrainingPage() {
  const features = getFeatures();
  return (
    <TrainingView
      aiPlansEnabled={features.aiPlansEnabled}
      chatEnabled={features.chatEnabled}
    />
  );
}
