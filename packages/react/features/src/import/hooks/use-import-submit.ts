import { useExternalWrite } from "@kalaido/state/live";
import { useCallback } from "react";
import { submitImport } from "../submit-import";
import type { ImportColourChoice, PickedImportFile } from "../types";

/**
 * The hand-off half of an import surface: guards a double submit, uploads
 * with the organize pipeline queued, and hands the new ingest id back to
 * whoever decides where to go next.
 */
export function useImportSubmit(onSuccess: (ingestId: string) => void) {
  const write = useExternalWrite<
    { file: PickedImportFile; colour: ImportColourChoice },
    { readonly id: string }
  >({
    execute: async ({ file, colour }) =>
      (await submitImport({ file, colour, organizeAfter: true })).map((s) => ({
        id: s.id,
      })),
    concurrency: "ignore",
  });

  async function submit(
    file: PickedImportFile,
    colour: ImportColourChoice = { kind: "none" },
  ) {
    const outcome = await write.run({ file, colour });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      console.error("[import] ingest failed:", outcome.error);
      return;
    }
    onSuccess(outcome.id);
  }

  const clearError = useCallback(() => {
    write.reset();
  }, [write]);

  return {
    submitting: write.isPending,
    submitError: write.error ? write.error.message || "Import failed." : "",
    submit,
    clearError,
  };
}
