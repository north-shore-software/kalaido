import { useRef } from "react";
import { useIngestPipeline } from "@/hooks/use-ingest-pipeline";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { pipelineProgress } from "../pipeline-progress";

export function usePipelineProgress(ingestId: string) {
  const { stage, error } = useIngestPipeline(ingestId);
  const { records: mapRuns } = useLiveCollection("map_run", {
    sort: "-created",
  });
  const { records: organizeRuns } = useLiveCollection("organize_run", {
    sort: "-created",
  });

  const highWater = useRef(0);
  const next = pipelineProgress({
    stage,
    mapRun: mapRuns[0],
    organizeRun: organizeRuns[0],
  });

  highWater.current = Math.max(highWater.current, next);

  return { stage, error, progress: highWater.current };
}
