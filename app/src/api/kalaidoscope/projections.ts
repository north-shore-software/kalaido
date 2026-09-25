import { ClientResponseError } from "pocketbase";
import type { Result } from "neverthrow";
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
  projectionId: string;
}

export interface RegenerateProjectionResult {
  snapshotId: string;
}

/**
 * Create a new projection container. Authoring then proceeds through a
 * refinement session over the projection's initial snapshot (see
 * `api/kalaidoscope/refinements.ts`); the lens is born when that refinement is
 * committed with `updateLensAndContext`.
 */
export async function createProjection(
  name: string,
  opts: {
    /** What the projection is for — a chat's brief. Empty for typed creates. */
    description?: string;
  } = {},
): Promise<Result<CreateProjectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateProjectionResult>("/api/projections", {
      method: "POST",
      body: opts.description
        ? { name, description: opts.description }
        : { name },
    }),
  );
}

/**
 * Regenerate a projection's snapshot by re-applying its lens to freshly resolved
 * context. Defaults to producing a *pending* candidate for review; pass
 * `autoApprove` to promote straight to live. The backend derives the status from
 * `preview` (preview=true → pending candidate, preview=false → approved/live).
 */
export async function regenerateProjection(
  projectionId: string,
  autoApprove = false,
  opts?: {
    discardEngaged?: boolean;
    foldIn?: boolean;
  },
): Promise<Result<RegenerateProjectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<RegenerateProjectionResult>(
      `/api/projections/${projectionId}/candidates`,
      // requestKey: null opts out of the SDK's auto-cancellation — without it
      // a second generate call aborts the first client-side while the server
      // keeps running both, surfacing as a phantom "Failed to refresh".
      {
        method: "POST",
        body: {
          preview: !autoApprove,
          discardEngaged: opts?.discardEngaged,
          foldIn: opts?.foldIn,
        },
        requestKey: null,
      },
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
