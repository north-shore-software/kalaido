import type { OrganizeStatus } from "@/api/kalaidoscope/organize";

const MAX_ROUNDS = 30;

const IMPORTING = 0.05;
const MAPPING_START = 0.1;
const MAPPING_SPAN = 0.6;
const ORGANIZING_START = 0.7;
const ORGANIZING_SPAN = 0.25;

/**
 * The splash's view of the workspace organise pipeline: `""` until the first
 * status arrives, then the stage that is actually moving, and `idle` once
 * nothing is in flight or queued — whether or not work is left over.
 */
export type OrganizeStage =
  | ""
  | "importing"
  | "mapping"
  | "organizing"
  | "idle";

export function organizeStage(status: OrganizeStatus | null): OrganizeStage {
  if (!status) return "";
  if (status.imports.pending > 0) return "importing";
  if (
    status.map.state === "annotating" ||
    status.map.state === "consolidating"
  ) {
    return "mapping";
  }
  if (
    status.discover.state === "running" ||
    status.discover.state === "pending"
  ) {
    return "organizing";
  }
  return "idle";
}

function fraction(done: number | undefined, total: number | undefined): number {
  if (!total || total <= 0 || !done || done <= 0) return 0;
  return Math.min(1, done / total);
}

export function pipelineProgress(status: OrganizeStatus | null): number {
  const stage = organizeStage(status);
  switch (stage) {
    case "idle":
      return 1;
    case "organizing": {
      const running = status?.discover.running;
      const rounds = running ? status?.discover.runs[running]?.rounds : 0;
      return ORGANIZING_START + ORGANIZING_SPAN * fraction(rounds, MAX_ROUNDS);
    }
    case "mapping":
      return (
        MAPPING_START +
        MAPPING_SPAN * fraction(status?.map.annotated, status?.fragments)
      );
    default:
      return IMPORTING;
  }
}
