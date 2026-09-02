import { useRef } from "react";
import { useIngestPipeline } from "@/hooks/use-ingest-pipeline";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { pipelineProgress } from "../pipeline-progress";

export function usePipelineProgress(ingestId: string) {
  const { stage, error } = useIngestPipeline(ingestId);
  const { records: maps } = useLiveCollection("kalaidoscope_map");
  const { records: discoverRuns } = useLiveCollection("discover_run", {
    sort: "-created",
  });

  const highWater = useRef(0);
  const next = pipelineProgress({
    stage,
    map: maps[0],
    discoverRun: discoverRuns[0],
  });

  highWater.current = Math.max(highWater.current, next);

  return { stage, error, progress: highWater.current };
}
