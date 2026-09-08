import { UploadIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ImportFields } from "@/features/import/components/import-fields";
import { useImportPicker } from "@/features/import/hooks/use-import-picker";
import { useImportSubmit } from "@/features/import/hooks/use-import-submit";
import { clearStageEntry } from "@/hooks/app-state-actions.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OnboardingShell } from "../components/onboarding-shell";
import { onboardingImportTransitions as transitions } from "./OnboardingImport.transitions";

export default function OnboardingImport() {
  const { go } = useAppNavigate();
  const { submitting, submitError, submit, clearError } = useImportSubmit(
    (ingestId) =>
      go(transitions.startPipeline, { params: { ingestId }, replace: true }),
  );
  const picker = useImportPicker(clearError);

  useEffect(() => {
    clearStageEntry();
  }, []);

  return (
    <OnboardingShell
      showMark={false}
      title="Would you like to import your notes?"
      description="Bring in your personal notes, research papers, documents, or message archives to let Kalaido organise and index them."
    >
      <ImportFields picker={picker} disabled={submitting} />

      {submitError && (
        <p className="text-meta text-destructive">{submitError}</p>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={submitting}
          onClick={() => go(transitions.skip, { replace: true })}
        >
          Skip and start blank
        </Button>
        <Button
          variant="commit"
          disabled={!picker.path || submitting}
          onClick={() => void submit(picker.path)}
        >
          <UploadIcon />
          {submitting ? "Uploading…" : "Import"}
        </Button>
      </div>
    </OnboardingShell>
  );
}

export const onboardingImportRoute = defineRoute({
  id: "onboarding-import",
  path: "/onboarding/import",
  feature: "Onboarding",
  requiredScope: ["kalaidoscope"],
  transitions,
  Component: OnboardingImport,
});
