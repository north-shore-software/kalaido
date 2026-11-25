import type { IngestPhase } from "@kalaido/client/kalaidoscope/ingest";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useExternalWrite } from "@kalaido/state/live";
import { useCallback, useEffect, useRef, useState } from "react";
import { submitImport } from "../submit-import";
import type { ImportRequest } from "../types";

/**
 * Path B — asynchronous batch file ingest. Uploads the selected file via
 * `useExternalWrite` (returning `{ id }`), then follows the `ingest` record
 * via live collection read. The backend reports only a final count (no running
 * total), so progress is indeterminate until `done`.
 */
export function useFileIngest() {
  const [activeIngestId, setActiveIngestId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const uploadWrite = useExternalWrite<
    { req: ImportRequest; signal: AbortSignal },
    { readonly id: string }
  >({
    execute: async ({ req, signal }) =>
      (await submitImport(req, signal)).map((s) => ({ id: s.id })),
    concurrency: "ignore",
  });

  const liveIngest = useLiveCollection("ingest", {
    filter: activeIngestId ? `id="${activeIngestId}"` : undefined,
    enabled: activeIngestId !== null && !cancelled,
  });

  const record = activeIngestId ? liveIngest.records[0] : undefined;

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runIngest = useCallback(
    async (req: ImportRequest) => {
      cleanup();
      const controller = new AbortController();
      abortRef.current = controller;
      setCancelled(false);
      setActiveIngestId(null);
      setUploadError("");

      const outcome = await uploadWrite.run({ req, signal: controller.signal });
      abortRef.current = null;

      if (outcome.status === "ignored") return;
      if (outcome.status === "error") {
        if (controller.signal.aborted) {
          setCancelled(true);
        } else {
          setUploadError(outcome.error.message || "Import failed.");
        }
        return;
      }

      setActiveIngestId(outcome.id);
    },
    [cleanup, uploadWrite],
  );

  const cancel = useCallback(() => {
    // Stops listening and aborts the upload if still in flight. A job already
    // accepted by the server keeps processing in the background.
    cleanup();
    setActiveIngestId(null);
    setCancelled(true);
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    uploadWrite.reset();
    setActiveIngestId(null);
    setCancelled(false);
    setUploadError("");
  }, [cleanup, uploadWrite]);

  useEffect(() => cleanup, [cleanup]);

  let phase: IngestPhase = "idle";
  let imported = 0;
  let errorMsg = uploadError;

  if (cancelled) {
    phase = "cancelled";
  } else if (uploadWrite.isPending) {
    phase = "running";
  } else if (uploadError) {
    phase = "error";
  } else if (activeIngestId) {
    if (record?.status === "done") {
      phase = "done";
      imported = record.ingested;
    } else if (record?.status === "error") {
      phase = "error";
      errorMsg = record.error || "Import failed.";
    } else if (liveIngest.status === "error") {
      phase = "error";
      errorMsg = liveIngest.error?.message || "Lost the import connection.";
    } else {
      phase = "running";
    }
  }

  return {
    phase,
    imported,
    total: 0, // backend reports no running total — progress is indeterminate.
    errorMsg,
    runIngest,
    cancel,
    reset,
  };
}
