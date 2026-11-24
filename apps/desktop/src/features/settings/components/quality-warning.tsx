import { WarningIcon } from "@phosphor-icons/react";
import { RECOMMENDED_MODEL } from "@kalaido/client/kalaidoscope/llm-config";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@kalaido/primitives/shadcn/alert";

export function QualityWarning() {
  return (
    <Alert>
      <WarningIcon />
      <AlertTitle>Quality may be degraded</AlertTitle>
      <AlertDescription>
        {RECOMMENDED_MODEL} is the recommended model. Other models may produce
        lower-quality results.
      </AlertDescription>
    </Alert>
  );
}
