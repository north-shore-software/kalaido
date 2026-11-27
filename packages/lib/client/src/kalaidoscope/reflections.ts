import type { Result } from "neverthrow";
import { ClientResponseError } from "pocketbase";
import { GenerationInFlightError } from "#kalaidoscope/projections";
import { withActiveClient } from "./_active";
import type { ContextSpec, TimeWindow, WindowSpec } from "./chat";

export const REFLECTION_EMPTY_WINDOW_OUTPUT = "No fragments in this window.";
export const REFLECTION_MODEL_EMPTY = "empty";
export const REFLECTION_MODEL_MANUAL = "manual";

export function isReflectionSentinelModel(model: string | undefined): boolean {
  return model === REFLECTION_MODEL_EMPTY || model === REFLECTION_MODEL_MANUAL;
}

export interface CreateReflectionResult {
  readonly id: string;
}

export interface ReflectionLens {
  readonly lensId: string;
  readonly prompt: string;
}

export interface EditReflectionWindowResult {
  readonly id: string;
}

export interface RegenerateReflectionResult {
  // Reflection generation is window-aware: one snapshot per generated window
  // (catch-up can produce several), so the backend returns a list.
  readonly ids: readonly string[];
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
  return (
    await withActiveClient((client) =>
      client.send<{ reflectionId: string }>("/api/reflections", {
        method: "POST",
        body: { name, ...(windowSpec ? { windowSpec } : {}) },
      }),
    )
  ).map((r) => ({ id: r.reflectionId }));
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
  /** The approved snapshot was produced by a lens other than the current one. */
  lensOutdated?: boolean;
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
  patch: {
    name?: string;
    pinned?: boolean;
    windowSpec?: WindowSpec;
    generateWithModel?: string;
  },
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
 * multiple pending windows the backend requires `windowId` or `allWindows` — pass `allWindows`
 * (or legacy `all`) to generate every pending window in one call.
 */
export async function regenerateReflection(
  reflectionId: string,
  autoApprove = true,
  opts?: { all?: boolean; allWindows?: boolean; windowId?: string },
): Promise<Result<RegenerateReflectionResult, Error>> {
  return (
    await withActiveClient((client) =>
      client.send<{ snapshotIds: string[] }>(
        `/api/reflections/${reflectionId}/generate-snapshot`,
        {
          method: "POST",
          body: {
            preview: !autoApprove,
            ...(opts?.allWindows || opts?.all ? { allWindows: true } : {}),
            ...(opts?.windowId ? { windowId: opts.windowId } : {}),
          },
        },
      ),
    )
  ).map((r) => ({ ids: r.snapshotIds }));
}

/**
 * Soft-delete a reflection. Mirrors `DELETE /api/reflections/:id`: the row
 * is stamped, its history stays, and `restoreReflection` brings it back.
 * Refused with {@link GenerationInFlightError} while a generation runs.
 */
export async function deleteReflection(
  reflectionId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    try {
      await client.send(`/api/reflections/${reflectionId}`, {
        method: "DELETE",
      });
    } catch (e) {
      if (e instanceof ClientResponseError && e.status === 409)
        throw new GenerationInFlightError();
      throw e;
    }
  });
}

/** Undo a soft delete. Mirrors `POST /api/reflections/:id/restore`. */
export async function restoreReflection(
  reflectionId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/reflections/${reflectionId}/restore`, {
      method: "POST",
    });
  });
}

/** Read a reflection's current standing lens prompt. Mirrors `GET /api/reflections/:id/lens`. */
export async function getReflectionLens(
  reflectionId: string,
): Promise<Result<ReflectionLens, Error>> {
  return withActiveClient((client) =>
    client.send<ReflectionLens>(`/api/reflections/${reflectionId}/lens`, {
      method: "GET",
      requestKey: null,
    }),
  );
}

/** Save a revised standing lens prompt directly. Mirrors `PUT /api/reflections/:id/lens`. */
export async function updateReflectionLens(
  reflectionId: string,
  prompt: string,
): Promise<Result<ReflectionLens, Error>> {
  return withActiveClient((client) =>
    client.send<ReflectionLens>(`/api/reflections/${reflectionId}/lens`, {
      method: "PUT",
      body: { prompt },
    }),
  );
}

/**
 * Directly edit the markdown/text of a specific reflection window's snapshot.
 * Appends a new approved revision (`generated_by_model = "manual"`). Mirrors
 * `POST /api/reflections/:id/windows/:windowId/edit`.
 */
export async function editReflectionWindowSnapshot(
  reflectionId: string,
  windowId: string,
  output: string,
): Promise<Result<EditReflectionWindowResult, Error>> {
  return (
    await withActiveClient((client) =>
      client.send<{ snapshotId: string }>(
        `/api/reflections/${reflectionId}/windows/${windowId}/edit`,
        {
          method: "POST",
          body: { output },
        },
      ),
    )
  ).map((r) => ({ id: r.snapshotId }));
}

/** Candidate sample window returned by `POST /api/reflections/preview-windows`. */
export interface PreviewReflectionWindow extends TimeWindow {
  id: string;
  key: string;
  fragmentCount: number;
}

export interface PreviewReflectionWindowsResult {
  windows: PreviewReflectionWindow[];
  defaultWindowId?: string;
}

export interface PreviewReflectionResult {
  output: string;
  empty: boolean;
  fragmentCount: number;
}

export interface SaveReflectionTuningInput {
  refinementId?: string;
  windowSpec?: WindowSpec;
  contextSpec?: ContextSpec;
  lensPrompt?: string;
  name?: string;
}

export interface SaveReflectionTuningResult {
  readonly id: string;
  readonly lensId: string;
}

export interface DiscardReflectionDraftResult {
  readonly id: string;
  readonly deletedReflection?: boolean;
  readonly revertedToProposed?: boolean;
}

/**
 * Enumerate sample windows and matching fragment counts for a staged
 * `(windowSpec, contextSpec)` without mutating any reflection record or making
 * any LLM call. Mirrors `POST /api/reflections/preview-windows`.
 */
export async function previewReflectionWindows(
  windowSpec: WindowSpec,
  contextSpec: ContextSpec,
  reflectionId?: string,
): Promise<Result<PreviewReflectionWindowsResult, Error>> {
  return withActiveClient((client) =>
    client.send<PreviewReflectionWindowsResult>(
      "/api/reflections/preview-windows",
      {
        method: "POST",
        requestKey: null,
        body: {
          ...(reflectionId ? { reflectionId } : {}),
          windowSpec,
          contextSpec,
        },
      },
    ),
  );
}

/**
 * Run a staged standing lens strictly in isolation against one sample window's
 * fragments (zero chat history, zero database writes). Mirrors
 * `POST /api/reflections/preview`.
 */
export async function previewReflection(input: {
  reflectionId?: string;
  lensPrompt: string;
  contextSpec: ContextSpec;
  window: TimeWindow;
  generateWithModel?: string;
}): Promise<Result<PreviewReflectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<PreviewReflectionResult>("/api/reflections/preview", {
      method: "POST",
      requestKey: null,
      body: {
        ...(input.reflectionId ? { reflectionId: input.reflectionId } : {}),
        lensPrompt: input.lensPrompt,
        contextSpec: input.contextSpec,
        window: {
          id: input.window.id ?? "",
          start: input.window.start,
          end: input.window.end,
        },
        ...(input.generateWithModel
          ? { generateWithModel: input.generateWithModel }
          : {}),
      },
    }),
  );
}

/**
 * Atomically persist staged schedule, sources, standing lens, and optional name
 * on Save. Uses the refinement commit endpoint when `refinementId` is present,
 * or `POST /api/reflections/:id/save` when no chat session was opened.
 */
export async function saveReflectionTuning(
  reflectionId: string,
  input: SaveReflectionTuningInput,
): Promise<Result<SaveReflectionTuningResult, Error>> {
  const path = input.refinementId
    ? `/api/reflections/${reflectionId}/refinements/${input.refinementId}/commit`
    : `/api/reflections/${reflectionId}/save`;
  const body = {
    ...(input.windowSpec ? { windowSpec: input.windowSpec } : {}),
    ...(input.contextSpec ? { contextSpec: input.contextSpec } : {}),
    ...(input.lensPrompt !== undefined ? { lensPrompt: input.lensPrompt } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
  return (
    await withActiveClient((client) =>
      client.send<{ id?: string; lensId?: string }>(path, {
        method: "POST",
        body,
      }),
    )
  ).map((r) => ({ id: r.id || reflectionId, lensId: r.lensId ?? "" }));
}

/**
 * Discard an unsaved reflection draft (`current_lens_id == ""`): hard-deletes
 * user-created drafts or reverts Discover proposals back to `proposed`.
 * Mirrors `POST /api/reflections/:id/draft/discard`.
 */
export async function discardReflectionDraft(
  reflectionId: string,
): Promise<Result<DiscardReflectionDraftResult, Error>> {
  return withActiveClient((client) =>
    client.send<DiscardReflectionDraftResult>(
      `/api/reflections/${reflectionId}/draft/discard`,
      { method: "POST", body: {} },
    ),
  );
}
