import { getFeatures } from "@/lib/system/features";
import { LabsView } from "@/components/labs/LabsView";

export default function LabsPage() {
  return <LabsView extractionEnabled={getFeatures().labsExtractionEnabled} />;
}
