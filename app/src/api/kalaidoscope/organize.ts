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
    unconsolidated: number;
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
  /** Waves start on their own (KALAIDO_AUTO_WAVE) or only from Start. */
  policy?: { wave: boolean };
  reconcile: ReconcileStatus;
  colour?: ColourStatus;
}

export interface ColourStatus {
  promptColoursCount: number;
  totalColoursCount: number;
  unjudgedFragments: number;
  draining: boolean;
}

export interface CurrentEntityInfo {
  id: string;
  type: string;
}

export interface WaveProgress {
  completed: number;
  total: number;
}

/**
 * The reconcile wave's state. `lastStarted` at or after a Start press, with
 * `running` false, means the wave that press began has ended.
 */
export interface ReconcileStatus {
  running: boolean;
  /** RFC3339; absent until a wave has started. */
  lastStarted?: string;
  /** What ended the most recent wave; absent when it ran clean. */
  lastError?: string;
  /** RFC3339; absent until a wave has completed without error. */
  lastCompleted?: string;
  /** RFC3339; absent unless the most recent wave was cancelled. */
  lastCancelled?: string;
  currentEntity?: CurrentEntityInfo;
  progress?: WaveProgress;
}

export async function getOrganizeStatus(): Promise<
  Result<OrganizeStatus, Error>
> {
  return withActiveClient((client) =>
    client.send<OrganizeStatus>("/api/status", { method: "GET" }),
  );
}
