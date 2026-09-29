import { useState } from "react";
import { ingestFile } from "@/api/kalaidoscope/ingest";

/**
 * The ingest half of an import surface: guards a double submit, uploads, and
 * hands the new ingest id back to whoever decides where to go next.
 */
export function useImportSubmit(onSuccess: (ingestId: string) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function submit(path: string) {
    if (!path || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const created = await ingestFile({ path, organizeAfter: true });
    if (created.isErr()) {
      console.error("[import] ingest failed:", created.error);
      setSubmitError(created.error.message || "Import failed.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onSuccess(created.value.id);
  }

  function clearError() {
    setSubmitError("");
  }

  return { submitting, submitError, submit, clearError };
}
