import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";
import type { TimeWindow, WindowSpec } from "./chat";

export interface CreateReflectionResult {
  reflectionId: string;
}

export interface RegenerateReflectionResult {
  // Reflection generation is window-aware: one snapshot per generated window
  // (catch-up can produce several), so the backend returns a list.
  snapshotIds: string[];
}

/**
 * Create a new reflection container with its schedule. Authoring proceeds
 * through a refinement session over it (see `api/kalaidoscope/refinements.ts`);
 * the lens is born when that refinement is committed. A `windowSpec.startTime`
 * in the past means "summarize from then": every grid window since is pending
 * and gets generated once the lens exists.
 */
export async function createReflection(
  name: string,
  windowSpec?: WindowSpec,
): Promise<Result<CreateReflectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateReflectionResult>("/api/reflections", {
      method: "POST",
      body: { name, ...(windowSpec ? { windowSpec } : {}) },
    }),
  );
}

/**
 * One window of a reflection's series, as served by
 * `GET /api/reflections/:id/windows` (mirrors `api.WindowInfo`).
 */
export interface ReflectionWindow extends TimeWindow {
  id: string;
  /** The `start_end` key snapshots for this window are filed under. */
  key: string;
  hasApproved: boolean;
  generating: boolean;
  /** Materialized by an explicit backfill rather than by the grid. */
  backfilled: boolean;
  /** An approved snapshot exists but the window's context has changed since. */
  stale?: boolean;
}

export interface ReflectionWindowsResult {
  windows: ReflectionWindow[];
  /** The window a new refinement defaults to; absent for an unscheduled reflection. */
  currentWindowId?: string;
}

/**
 * Materialize every grid window between `fromISO` and the first one the
 * schedule already covers, and generate them in the background. Progress
 * arrives as `reflection_snapshot` rows over the live subscription. Fails with
 * 400 when `fromISO` is not before the covered range.
 */
export async function backfillReflection(
  reflectionId: string,
  fromISO: string,
): Promise<Result<{ windows: TimeWindow[] }, Error>> {
  return withActiveClient((client) =>
    client.send<{ windows: TimeWindow[] }>(
      `/api/reflections/${reflectionId}/backfill`,
      { method: "POST", body: { from: fromISO } },
    ),
  );
}

/** The reflection's materialized windows, oldest first. */
export async function listReflectionWindows(
  reflectionId: string,
): Promise<Result<ReflectionWindowsResult, Error>> {
  return withActiveClient((client) =>
    client.send<ReflectionWindowsResult>(
      `/api/reflections/${reflectionId}/windows`,
      { method: "GET" },
    ),
  );
}

/**
 * Update a reflection's mutable fields. `name` renames it; `pinned` toggles the
 * current user's membership in the `pinned_by` relation (true to pin, false to
 * unpin); `windowSpec` appends a new schedule version effective from now (the
 * grid origin is kept server-side when `startTime` is omitted). Mirrors
 * `PATCH /api/reflections/:id` (`UpdateReflectionRequest`).
 */
export async function updateReflection(
  reflectionId: string,
  patch: { name?: string; pinned?: boolean; windowSpec?: WindowSpec },
): Promise<Result<{ id: string }, Error>> {
  return withActiveClient((client) =>
    client.send<{ id: string }>(`/api/reflections/${reflectionId}`, {
      method: "PATCH",
      body: patch,
    }),
  );
}

/**
 * Generate a reflection snapshot by re-applying its lens over its window(s).
 * Defaults to auto-approve (reflections have no review gate, so the new snapshot
 * goes live immediately); pass `autoApprove: false` to mint a pending candidate
 * (used to bootstrap a refinement session for a brand-new reflection). The
 * backend derives status from `preview` (preview=true → pending).
 *
 * Returns one snapshot id per generated window. When a scheduled reflection has
 * multiple pending windows the backend requires `windowId` or `all` — pass `all`
 * to generate every pending window in one call.
 */
export async function regenerateReflection(
  reflectionId: string,
  autoApprove = true,
  opts?: { all?: boolean; windowId?: string },
): Promise<Result<RegenerateReflectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<RegenerateReflectionResult>(
      `/api/reflections/${reflectionId}/generate-snapshot`,
      {
        method: "POST",
        body: {
          preview: !autoApprove,
          ...(opts?.all ? { all: true } : {}),
          ...(opts?.windowId ? { windowId: opts.windowId } : {}),
        },
      },
    ),
  );
}

/** Delete a reflection outright. Mirrors `DELETE /api/reflections/:id`. */
export async function deleteReflection(
  reflectionId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/reflections/${reflectionId}`, { method: "DELETE" });
  });
}
