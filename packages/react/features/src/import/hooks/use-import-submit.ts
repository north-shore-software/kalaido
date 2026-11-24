import { useCallback, useState } from "react";
import { submitImport } from "../submit-import";
import type { ImportColourChoice, PickedImportFile } from "../types";

/**
 * The hand-off half of an import surface: guards a double submit, uploads
 * with the organize pipeline queued, and hands the new ingest id back to
 * whoever decides where to go next.
 */
export function useImportSubmit(onSuccess: (ingestId: string) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function submit(
    file: PickedImportFile,
    colour: ImportColourChoice = { kind: "none" },
  ) {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const created = await submitImport({ file, colour, organizeAfter: true });
    if (created.isErr()) {
      console.error("[import] ingest failed:", created.error);
      setSubmitError(created.error.message || "Import failed.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onSuccess(created.value.id);
  }

  const clearError = useCallback(() => {
    setSubmitError("");
  }, []);

  return { submitting, submitError, submit, clearError };
}
