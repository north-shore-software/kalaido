import { TriangleAlert } from "lucide-react";
import { RECOMMENDED_MODEL } from "@/api/kalaidoscope/llm-config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function QualityWarning() {
  return (
    <Alert>
      <TriangleAlert />
      <AlertTitle>Quality may be degraded</AlertTitle>
      <AlertDescription>
        {RECOMMENDED_MODEL} is the recommended model. Other models may produce
        lower-quality results.
      </AlertDescription>
    </Alert>
  );
}
