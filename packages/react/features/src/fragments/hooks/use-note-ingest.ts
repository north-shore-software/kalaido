import {
  type IngestPhase,
  ingestNote,
} from "@kalaido/client/kalaidoscope/ingest";
import { useExternalWrite } from "@kalaido/state/live";
import { useCallback, useRef, useState } from "react";

/**
 * Path A — synchronous single-entry ingest. Thin React state around
 * `ingestNote` (which wraps POST /api/ingest); used for quick text captures
 * such as the New Fragment modal. For file/batch uploads see `use-file-ingest`.
 */
export function useNoteIngest() {
  const [phase, setPhase] = useState<IngestPhase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const ingestWrite = useExternalWrite<
    {
      content: string;
      type: string;
      skipDuplicates: boolean;
      signal: AbortSignal;
    },
    void
  >({
    execute: ({ content, type, skipDuplicates, signal }) =>
      ingestNote(content, type, skipDuplicates, signal),
    concurrency: "ignore",
  });

  const runIngest = useCallback(
    async (content: string, type = "note", skipDuplicates = false) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("running");
      setErrorMsg("");

      const outcome = await ingestWrite.run({
        content: trimmed,
        type,
        skipDuplicates,
        signal: controller.signal,
      });
      abortRef.current = null;

      if (outcome.status === "ignored") return;
      if (outcome.status === "success") {
        setPhase("done");
      } else if (controller.signal.aborted) {
        setPhase("cancelled");
      } else {
        setErrorMsg(outcome.error.message || "Failed to save.");
        setPhase("error");
      }
    },
    [ingestWrite],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    ingestWrite.reset();
    setPhase("idle");
    setErrorMsg("");
  }, [ingestWrite]);

  return { phase, errorMsg, runIngest, reset };
}
