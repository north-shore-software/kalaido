import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

/**
 * Workspace organise-pipeline status, mirroring `api.OrganizeStatus` from
 * `GET /api/organize`. Derived server-side from rows plus the workers' own
 * in-flight flags; nothing is stored, so re-fetch whenever the underlying
 * collections change (see `useOrganizeStatus`).
 */
export type MapState =
  | "empty"
  | "unannotated"
  | "annotating"
  | "consolidating"
  | "folding"
  | "settled";

export type DiscoverState =
  | "never_run"
  | "pending"
  | "running"
  | "due"
  | "settled";

export type DiscoverKind = "colours" | "projections" | "reflections";

export interface RunInfo {
  id: string;
  status: string;
  error?: string;
  model?: string;
  rounds?: number;
  mapVersion?: number;
  finished: string;
  /** The row says running but no worker in this process is running it. */
  interrupted?: boolean;
}

export interface OrganizeStatus {
  fragments: number;
  imports: { pending: number; lastError?: string };
  map: {
    state: MapState;
    version: number;
    annotated: number;
    pendingAnnotation: number;
    unfolded: number;
    lastRun?: RunInfo;
    lastDrainError?: string;
  };
  discover: {
    state: DiscoverState;
    running?: DiscoverKind | "";
    pending: DiscoverKind[];
    due: DiscoverKind[];
    runs: Partial<Record<DiscoverKind, RunInfo>>;
    proposals: { projections: number; reflections: number };
  };
  policy: { autoMap: boolean; wave: boolean };
}

export async function getOrganizeStatus(): Promise<
  Result<OrganizeStatus, Error>
> {
  return withActiveClient((client) =>
    client.send<OrganizeStatus>("/api/organize", { method: "GET" }),
  );
}
