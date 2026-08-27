import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

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
): Promise<Result<CreateProjectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateProjectionResult>("/api/projections", {
      method: "POST",
      body: { name },
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
): Promise<Result<RegenerateProjectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<RegenerateProjectionResult>(
      `/api/projections/${projectionId}/candidates`,
      // requestKey: null opts out of the SDK's auto-cancellation — without it
      // a second generate call aborts the first client-side while the server
      // keeps running both, surfacing as a phantom "Failed to refresh".
      { method: "POST", body: { preview: !autoApprove }, requestKey: null },
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
  patch: { name?: string; pinned?: boolean },
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
      filter: client.filter('projection_id = {:id} && status = "pending"', {
        id: projectionId,
      }),
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
