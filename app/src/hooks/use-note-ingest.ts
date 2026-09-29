import { useCallback, useRef, useState } from "react";
import type { IngestPhase } from "@/api/kalaidoscope/ingest.ts";
import { ingestNote } from "@/api/kalaidoscope/ingest.ts";

/**
 * Path A — synchronous single-entry ingest. Thin React state around
 * `ingestNote` (which wraps POST /api/ingest); used for quick text captures
 * such as the New Fragment modal. For file/batch uploads see `use-file-ingest`.
 */
export function useNoteIngest() {
  const [phase, setPhase] = useState<IngestPhase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const runIngest = useCallback(
    async (content: string, type = "note", skipDuplicates = false) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("running");
      setErrorMsg("");

      const result = await ingestNote(
        trimmed,
        type,
        skipDuplicates,
        controller.signal,
      );
      abortRef.current = null;

      if (result.isOk()) {
        setPhase("done");
      } else if (controller.signal.aborted) {
        setPhase("cancelled");
      } else {
        setErrorMsg(result.error.message || "Failed to save.");
        setPhase("error");
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setErrorMsg("");
  }, []);

  return { phase, errorMsg, runIngest, reset };
}
