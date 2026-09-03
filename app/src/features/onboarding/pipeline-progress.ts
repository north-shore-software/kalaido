import type { OrganizeStatus } from "@/api/kalaidoscope/organize";

const MAX_ROUNDS = 30;

const IMPORTING = 0.05;
const MAPPING_START = 0.1;
const MAPPING_SPAN = 0.6;
const ORGANIZING_START = 0.7;
const ORGANIZING_SPAN = 0.25;

/**
 * The splash's view of the workspace organise pipeline: `""` until the first
 * status arrives, then the stage that is actually moving, and `idle` once the
 * map and colours are done — whether or not work is left over. Projections and
 * reflections discovery run on behind the app and never hold the splash.
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
    status.discover.running === "colours" ||
    status.discover.pending.includes("colours")
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
      const rounds =
        status?.discover.running === "colours"
          ? status.discover.runs.colours?.rounds
          : 0;
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
