import { UploadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ingestFile } from "@/api/kalaidoscope/ingest";
import { Label } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { FilePicker } from "@/features/import/components/file-picker";
import { ImportPreview } from "@/features/import/components/import-preview";
import { useImportPicker } from "@/features/import/hooks/use-import-picker";
import { clearStageEntry } from "@/hooks/app-state-actions.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OnboardingShell } from "../components/onboarding-shell";
import { onboardingImportTransitions as transitions } from "./OnboardingImport.transitions";

export default function OnboardingImport() {
  const { go } = useAppNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { path, entries, scanning, pickError, chooseFile } = useImportPicker(
    () => setSubmitError(""),
  );

  useEffect(() => {
    clearStageEntry();
  }, []);

  async function runImport() {
    if (!path || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const created = await ingestFile({ path, organizeAfter: true });
    if (created.isErr()) {
      setSubmitError(created.error.message || "Import failed.");
      setSubmitting(false);
      return;
    }
    go(transitions.startPipeline, {
      params: { ingestId: created.value.id },
      replace: true,
    });
  }

  return (
    <OnboardingShell
      showMark={false}
      title="Would you like to import your notes?"
      description="Bring in your personal notes, research papers, documents, or message archives to let Kalaido organise and index them."
    >
      <section className="flex flex-col gap-2">
        <Label>File</Label>
        <FilePicker path={path} disabled={submitting} onChoose={chooseFile} />
        <p className="text-body-sm text-fg-3">
          Supported formats: Zip archives (.zip), Markdown &amp; plain text
          (.md, .txt), Word documents (.docx), and mailbox exports (.mbox,
          .eml).
        </p>
        {pickError && <p className="text-body-sm text-fg-3">{pickError}</p>}
        {path && <ImportPreview entries={entries} scanning={scanning} />}
      </section>

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
          disabled={!path || submitting}
          onClick={() => void runImport()}
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
