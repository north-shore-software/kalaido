import type { Result } from "neverthrow";
import { withActiveClient } from "./_active";

export interface CreateReflectionResult {
  reflectionId: string;
}

export interface RegenerateReflectionResult {
  // Reflection generation is window-aware: one snapshot per generated window
  // (catch-up can produce several), so the backend returns a list.
  snapshotIds: string[];
}

/**
 * Create a new reflection container. Authoring proceeds through a refinement
 * session over the reflection's initial snapshot (see
 * `api/kalaidoscope/refinements.ts`); the lens is born when that refinement is
 * committed with `updateLensAndContext`.
 */
export async function createReflection(
  name: string,
): Promise<Result<CreateReflectionResult, Error>> {
  return withActiveClient((client) =>
    client.send<CreateReflectionResult>("/api/reflections", {
      method: "POST",
      body: { name },
    }),
  );
}

/**
 * Update a reflection's mutable fields. `name` renames it; `pinned` toggles the
 * current user's membership in the `pinned_by` relation (true to pin, false to
 * unpin). Mirrors `PATCH /api/reflections/:id` (`UpdateReflectionRequest`).
 */
export async function updateReflection(
  reflectionId: string,
  patch: { name?: string; pinned?: boolean },
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
