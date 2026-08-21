import { useEffect, useState } from "react";
import {
  getIngest,
  type IngestStatus,
  subscribeIngest,
} from "@/api/kalaidoscope/ingest";

export type PipelineStage = "" | "mapping" | "organizing" | "done" | "error";

export function useIngestPipeline(recordId: string) {
  const [stage, setStage] = useState<PipelineStage>("");
  const [error, setError] = useState("");

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    const apply = (status: IngestStatus) => {
      if (cancelled) return;
      setStage(status.pipeline as PipelineStage);
      setError(status.pipelineError || status.error);
    };

    void (async () => {
      const sub = await subscribeIngest(recordId, apply);
      if (cancelled) {
        if (sub.isOk()) sub.value();
        return;
      }
      if (sub.isErr()) {
        setStage("error");
        setError(sub.error.message);
        return;
      }
      unsub = sub.value;
      const current = await getIngest(recordId);
      if (current.isOk()) apply(current.value);
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [recordId]);

  return { stage, error };
}
