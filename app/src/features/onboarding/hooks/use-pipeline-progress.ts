import { useRef } from "react";
import { useOrganizeStatus } from "@/hooks/use-organize-status";
import { organizeStage, pipelineProgress } from "../pipeline-progress";

/**
 * Splash-facing view of the workspace organise pipeline. The status is
 * workspace-wide, not per import: an `organize_after` import drains every
 * pending fragment anyway, so this is what actually happens. A fetch failure
 * reads as idle so the splash ends rather than spinning.
 */
export function usePipelineProgress() {
  const { status, error } = useOrganizeStatus();

  const stage = error ? "idle" : organizeStage(status);
  const next = error ? 1 : pipelineProgress(status);

  const highWater = useRef(0);
  highWater.current = Math.max(highWater.current, next);

  return { stage, error, progress: highWater.current };
}
