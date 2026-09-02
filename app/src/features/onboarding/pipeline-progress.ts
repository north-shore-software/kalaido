import type { PipelineStage } from "@/hooks/use-ingest-pipeline";

const MAX_ROUNDS = 30;

const IMPORTING = 0.05;
const MAPPING_START = 0.1;
const MAPPING_SPAN = 0.6;
const ORGANIZING_START = 0.7;
const ORGANIZING_SPAN = 0.25;

export interface PipelineProgressInput {
  stage: PipelineStage;
  map?: { annotated?: number; fragments?: number };
  discoverRun?: { rounds?: number };
}

function fraction(done: number | undefined, total: number | undefined): number {
  if (!total || total <= 0 || !done || done <= 0) return 0;
  return Math.min(1, done / total);
}

export function pipelineProgress({
  stage,
  map,
  discoverRun,
}: PipelineProgressInput): number {
  switch (stage) {
    case "done":
      return 1;
    case "organizing":
      return (
        ORGANIZING_START +
        ORGANIZING_SPAN * fraction(discoverRun?.rounds, MAX_ROUNDS)
      );
    case "mapping":
      return (
        MAPPING_START + MAPPING_SPAN * fraction(map?.annotated, map?.fragments)
      );
    default:
      return IMPORTING;
  }
}
