import { ok, type Result } from "neverthrow";
import { useState } from "react";
import { createColour } from "@/api/kalaidoscope/colours";
import { ingestFile } from "@/api/kalaidoscope/ingest";
import type { ImportColourChoice } from "../components/import-colour-field";

/**
 * The ingest half of an import surface: guards a double submit, creates the
 * colour when asked for a new one, uploads, and hands the new ingest id back
 * to whoever decides where to go next.
 */
export function useImportSubmit(onSuccess: (ingestId: string) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function submit(
    path: string,
    colour: ImportColourChoice = { kind: "none" },
  ) {
    if (!path || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const colourId = await resolveColour(colour);
    if (colourId.isErr()) {
      console.error("[import] create colour failed:", colourId.error);
      setSubmitError(colourId.error.message || "Couldn't create the colour.");
      setSubmitting(false);
      return;
    }
    const created = await ingestFile({
      path,
      organizeAfter: true,
      colourId: colourId.value,
    });
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

/** The colour to tag the import with, created first when it is a new one. */
async function resolveColour(
  choice: ImportColourChoice,
): Promise<Result<string | undefined, Error>> {
  switch (choice.kind) {
    case "none":
      return ok(undefined);
    case "existing":
      return ok(choice.id);
    case "new": {
      const res = await createColour({ name: choice.name.trim(), prompt: "" });
      return res.map((r) => r.colourId);
    }
  }
}
