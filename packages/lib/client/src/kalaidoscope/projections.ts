import type { Result } from "neverthrow";
import { ClientResponseError } from "pocketbase";
import { withActiveClient } from "./_active";
export type SnapshotEditType = "regeneration" | "refinement" | "manual";
export type SnapshotEditStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded";

export interface SnapshotEdit {
  id: string;
  sequence: number;
  type: SnapshotEditType;
  status: SnapshotEditStatus;
  contentBefore: string;
  contentAfter: string;
  blockIndex: number;
  fragmentId?: string;
  inlinedText?: string;
  anchorPrev?: string;
  anchorNext?: string;
  supersededBy?: string;
  undoable?: boolean;
  undoReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateProjectionResult {
  readonly id: string;
}

export interface RegenerateProjectionResult {
  readonly id: string;
  readonly refinementId?: string;
}

export interface ProjectionLens {
  readonly lensId: string;
  readonly prompt: string;
  readonly updating: boolean;
}

/**
 * Create a new projection container. Authoring then proceeds through a
 * unified interactive projection session.
 */
export async function createProjection(
  name: string,
  opts: {
    /** What the projection is for — a chat's brief. Empty for typed creates. */
    description?: string;
  } = {},
): Promise<Result<CreateProjectionResult, Error>> {
  return (
    await withActiveClient((client) =>
      client.send<{ projectionId: string }>("/api/projections", {
        method: "POST",
        body: opts.description
          ? { name, description: opts.description }
          : { name },
      }),
    )
  ).map((r) => ({ id: r.projectionId }));
}

/**
 * Run a 1-call anchored cross-session update on a saved projection, always
 * opening a pending draft and attached interactive session.
 */
export async function regenerateProjection(
  projectionId: string,
): Promise<Result<RegenerateProjectionResult, Error>> {
  return (
    await withActiveClient((client) =>
      client.send<{ snapshotId: string; refinementId?: string }>(
        `/api/projections/${projectionId}/candidates`,
        // requestKey: null opts out of the SDK's auto-cancellation — without it
        // a second generate call aborts the first client-side while the server
        // keeps running both, surfacing as a phantom "Failed to refresh".
        {
          method: "POST",
          body: { preview: true },
          requestKey: null,
        },
      ),
    )
  ).map((r) => ({ id: r.snapshotId, refinementId: r.refinementId }));
}

/**
 * Start a revision session for an up-to-date saved projection, seeding a fresh
 * pending draft from the current approved snapshot and binding a new chat session.
 */
export async function startProjectionRevise(
  projectionId: string,
  clientId?: string,
): Promise<
  Result<{ readonly id: string; readonly refinementId: string }, Error>
> {
  return (
    await withActiveClient((client) =>
      client.send<{ snapshotId: string; refinementId: string }>(
        `/api/projections/${projectionId}/sessions/revise`,
        {
          method: "POST",
          body: clientId ? { clientId } : {},
          requestKey: null,
        },
      ),
    )
  ).map((r) => ({ id: r.snapshotId, refinementId: r.refinementId }));
}

/** Read the projection's living editorial brief (`GET /api/projections/:id/lens`). */
export async function getProjectionLens(
  projectionId: string,
): Promise<Result<ProjectionLens, Error>> {
  return withActiveClient((client) =>
    client.send<ProjectionLens>(`/api/projections/${projectionId}/lens`, {
      method: "GET",
      requestKey: null,
    }),
  );
}

/** Directly update the projection's living editorial brief (`PUT /api/projections/:id/lens`). */
export async function updateProjectionLens(
  projectionId: string,
  prompt: string,
): Promise<Result<ProjectionLens, Error>> {
  return withActiveClient((client) =>
    client.send<ProjectionLens>(`/api/projections/${projectionId}/lens`, {
      method: "PUT",
      body: { prompt },
      requestKey: null,
    }),
  );
}

/** Discard a pending projection draft without altering the saved snapshot. */
export async function discardProjectionCandidate(
  projectionId: string,
  snapshotId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(
      `/api/projections/${projectionId}/candidates/${snapshotId}/discard`,
      { method: "POST", body: {}, requestKey: null },
    );
  });
}

/** Bulk-resolve every proposed edit hunk on a pending candidate. */
export async function resolveAllProjectionEdits(
  projectionId: string,
  snapshotId: string,
  status: "approved" | "rejected",
): Promise<Result<{ edits: SnapshotEdit[] }, Error>> {
  return withActiveClient((client) =>
    client.send<{ edits: SnapshotEdit[] }>(
      `/api/projections/${projectionId}/candidates/${snapshotId}/edits/resolve-all`,
      { method: "POST", body: { status }, requestKey: null },
    ),
  );
}

/**
 * Update a projection's mutable fields. `name` renames it; `pinned` toggles the
 * current user's membership in the `pinned_by` relation (true to pin, false to
 * unpin). Mirrors `PATCH /api/projections/:id` (`UpdateProjectionRequest`).
 */
export async function updateProjection(
  projectionId: string,
  patch: { name?: string; pinned?: boolean; generateWithModel?: string },
): Promise<Result<{ id: string }, Error>> {
  return withActiveClient((client) =>
    client.send<{ id: string }>(`/api/projections/${projectionId}`, {
      method: "PATCH",
      body: patch,
    }),
  );
}

/**
 * The newest pending candidate for a projection, or null if it has none.
 * Lets a caller about to review a projection find out whether a candidate is
 * already waiting, rather than generating a second one for nothing.
 */
export async function getPendingCandidate(
  projectionId: string,
): Promise<Result<{ id: string } | null, Error>> {
  return withActiveClient(async (client) => {
    const recs = await client.collection("projection_snapshot").getFullList({
      filter: client.filter(
        'projection_id = {:id} && status = "pending_review"',
        {
          id: projectionId,
        },
      ),
      sort: "-created",
      fields: "id",
      requestKey: null,
    });
    return recs.length > 0 ? { id: recs[0].id } : null;
  });
}

/** Approve a projection's pending candidate (`snapshotId`) → live. */
export async function approveProjectionCandidate(
  projectionId: string,
  snapshotId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(
      `/api/projections/${projectionId}/candidates/${snapshotId}/approve`,
      { method: "POST", body: {} },
    );
  });
}

export interface EditProjectionCandidateResult {
  fragmentId: string;
  edit: SnapshotEdit;
}

export async function editProjectionCandidate(
  projectionId: string,
  snapshotId: string,
  edit: { blockPosition: number; newText: string },
): Promise<Result<EditProjectionCandidateResult, Error>> {
  return withActiveClient((client) =>
    client.send<EditProjectionCandidateResult>(
      `/api/projections/${projectionId}/candidates/${snapshotId}/edit`,
      { method: "POST", body: edit, requestKey: null },
    ),
  );
}

export async function updateSnapshotEditStatus(
  projectionId: string,
  snapshotId: string,
  editId: string,
  status: SnapshotEditStatus,
): Promise<Result<{ edit: SnapshotEdit }, Error>> {
  return withActiveClient((client) =>
    client.send<{ edit: SnapshotEdit }>(
      `/api/projections/${projectionId}/candidates/${snapshotId}/edits/${editId}`,
      { method: "PATCH", body: { status }, requestKey: null },
    ),
  );
}

/** The server refused a delete because a generation is running for the entity. */
export class GenerationInFlightError extends Error {
  constructor() {
    super("A generation is running. Try again in a moment.");
    this.name = "GenerationInFlightError";
  }
}

/**
 * Soft-delete a projection. Mirrors `DELETE /api/projections/:id`: the row
 * is stamped, its history stays, and `restoreProjection` brings it back.
 * Refused with {@link GenerationInFlightError} while a generation runs.
 */
export async function deleteProjection(
  projectionId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    try {
      await client.send(`/api/projections/${projectionId}`, {
        method: "DELETE",
      });
    } catch (e) {
      if (e instanceof ClientResponseError && e.status === 409)
        throw new GenerationInFlightError();
      throw e;
    }
  });
}

/** Undo a soft delete. Mirrors `POST /api/projections/:id/restore`. */
export async function restoreProjection(
  projectionId: string,
): Promise<Result<void, Error>> {
  return withActiveClient(async (client) => {
    await client.send(`/api/projections/${projectionId}/restore`, {
      method: "POST",
    });
  });
}

/** Snapshot payload: the generated markdown, wrapped by {@link parseProjectionOutput}. */
export interface ProjectionOutput {
  content?: string;
}

/** A snapshot's `output` column holds the generated markdown as plain text. */
export function parseProjectionOutput(raw: unknown): ProjectionOutput {
  return typeof raw === "string" ? { content: raw } : {};
}
