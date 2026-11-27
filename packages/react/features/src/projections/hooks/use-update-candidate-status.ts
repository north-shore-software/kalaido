import {
  getProjectionCandidateStatus,
  regenerateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useExternalWrite } from "@kalaido/state/live";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Tracks an async Update claim on the review screen:
 * - While the claim is live (or the snapshot list is still loading on entry),
 *   reports `isGenerating = true`.
 * - If the claim disappears without transitioning to `pending_review`, queries
 *   `GET /api/projections/:id/candidates/:rid/status` once to surface any
 *   recorded backend failure inline alongside a Retry action.
 */
export function useUpdateCandidateStatus({
  id,
  snapshotId,
  isLoading,
  hasPending,
  isGeneratingClaim,
  hasSnapshotRecord,
  onViewReview,
}: {
  id: string;
  snapshotId: string;
  isLoading: boolean;
  hasPending: boolean;
  isGeneratingClaim: boolean;
  hasSnapshotRecord: boolean;
  onViewReview: (
    id: string,
    snapshotId: string,
    opts?: { replace?: boolean },
  ) => void;
}) {
  const client = useKalaidoscopeClient();
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [serverStillGenerating, setServerStillGenerating] = useState(false);

  const shouldCheckMissingClaim =
    Boolean(id && snapshotId) &&
    !isLoading &&
    !hasPending &&
    !isGeneratingClaim &&
    !hasSnapshotRecord;

  useEffect(() => {
    if (!shouldCheckMissingClaim || checkedFor === snapshotId) return;
    let cancelled = false;
    void getProjectionCandidateStatus(id, snapshotId).then((res) => {
      if (cancelled) return;
      setCheckedFor(snapshotId);
      if (res.isErr()) return;
      if (res.value.status === "error") {
        setUpdateError(res.value.error || "Update failed.");
        setServerStillGenerating(false);
      } else if (res.value.status === "generating") {
        setServerStillGenerating(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shouldCheckMissingClaim, checkedFor, id, snapshotId]);

  const retryWrite = useExternalWrite<string, { readonly id: string }>({
    execute: (targetId) => regenerateProjection(targetId, { async: true }),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  async function retryUpdate() {
    if (!id) return;
    const outcome = await retryWrite.run(id);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't retry update", {
        description: outcome.error.message,
      });
      return;
    }
    onViewReview(id, outcome.id, { replace: true });
  }

  const isGenerating =
    !hasPending &&
    !updateError &&
    (isGeneratingClaim ||
      serverStillGenerating ||
      (isLoading && !hasSnapshotRecord));

  return {
    isGenerating,
    updateError: hasPending ? null : updateError,
    retrying: retryWrite.isPending,
    retryUpdate,
  };
}
