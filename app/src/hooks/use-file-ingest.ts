import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FileIngestOptions,
  getIngest,
  ingestFile,
  type IngestPhase,
  type IngestStatus,
  subscribeIngest,
} from "@/api/kalaidoscope/ingest";

/**
 * Path B — asynchronous batch file ingest. Thin React state around the
 * `ingest`-collection helpers: uploads the selected file whole, then follows
 * the record's realtime progress. The backend reports only a final count (no
 * running total), so progress is indeterminate until `done`. Format detection
 * and the contents preview live in the Import page, not here.
 */
export function useFileIngest() {
  const [phase, setPhase] = useState<IngestPhase>("idle");
  const [imported, setImported] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const apply = useCallback((status: IngestStatus): boolean => {
    if (status.status === "done") {
      setImported(status.ingested);
      setPhase("done");
      return true;
    }
    if (status.status === "error") {
      setErrorMsg(status.error || "Import failed.");
      setPhase("error");
      return true;
    }
    return false;
  }, []);

  const runIngest = useCallback(
    async (opts: FileIngestOptions) => {
      cleanup();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("running");
      setImported(0);
      setErrorMsg("");

      const created = await ingestFile(opts, controller.signal);
      if (created.isErr()) {
        if (controller.signal.aborted) {
          setPhase("cancelled");
        } else {
          setErrorMsg(created.error.message || "Import failed.");
          setPhase("error");
        }
        abortRef.current = null;
        return;
      }
      abortRef.current = null;

      // A tiny file may already be terminal before we attach a subscription.
      if (apply(created.value)) return;

      const sub = await subscribeIngest(created.value.id, apply);
      if (sub.isErr()) {
        setErrorMsg(sub.error.message || "Lost the import connection.");
        setPhase("error");
        return;
      }
      unsubRef.current = sub.value;

      // Guard the create→subscribe gap: re-read once, in case the final update
      // fired before the subscription attached. (A now-idle subscription on a
      // finished record is harmless; it's dropped on the next run / unmount.)
      const current = await getIngest(created.value.id);
      if (current.isOk()) apply(current.value);
    },
    [apply, cleanup],
  );

  const cancel = useCallback(() => {
    // Stops listening and aborts the upload if still in flight. A job already
    // accepted by the server keeps processing in the background.
    cleanup();
    setPhase("cancelled");
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase("idle");
    setImported(0);
    setErrorMsg("");
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

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
