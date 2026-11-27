import {
  approveProjectionCandidate,
  type DiscardProjectionResult,
  discardProjectionCandidate,
} from "@kalaido/client/kalaidoscope/projections";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { useExternalWrite } from "@kalaido/state/live";
import { useRef } from "react";
import { toast } from "sonner";

export interface ReviewActionCallbacks {
  id: string;
  pendingId: string | undefined;
  session: RefineSession;
  onCloseConfirmDiscard: () => void;
  onApproveSuccess: (id: string) => void;
  onBackToDetail: (id: string) => void;
  onBackToList: (opts?: { replace?: boolean }) => void;
}

export function useProjectionReviewActions(callbacks: ReviewActionCallbacks) {
  const client = useKalaidoscopeClient();
  const { id, pendingId, session } = callbacks;
  const discardResultRef = useRef<DiscardProjectionResult | null>(null);

  const approveWrite = useExternalWrite<
    { projectionId: string; snapshotId: string },
    void
  >({
    execute: ({ projectionId, snapshotId: targetSnapshotId }) =>
      approveProjectionCandidate(projectionId, targetSnapshotId),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const discardWrite = useExternalWrite<
    { projectionId: string; snapshotId: string },
    void
  >({
    execute: async ({ projectionId, snapshotId: targetSnapshotId }) => {
      const res = await discardProjectionCandidate(
        projectionId,
        targetSnapshotId,
      );
      if (res.isOk()) {
        discardResultRef.current = res.value;
      }
      return res.map(() => undefined);
    },
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const busy =
    approveWrite.isPending || discardWrite.isPending || session.committing;

  async function save() {
    if (!id || !pendingId || busy) return;
    if (session.started) {
      if (await session.commit(id)) {
        callbacks.onApproveSuccess(id);
      }
      return;
    }
    const outcome = await approveWrite.run({
      projectionId: id,
      snapshotId: pendingId,
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to save", { description: outcome.error.message });
      return;
    }
    callbacks.onApproveSuccess(id);
  }

  async function discard() {
    if (!id || !pendingId || busy) return;
    discardResultRef.current = null;
    const outcome = await discardWrite.run({
      projectionId: id,
      snapshotId: pendingId,
    });
    callbacks.onCloseConfirmDiscard();
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to discard draft", {
        description: outcome.error.message,
      });
      return;
    }
    const result = discardResultRef.current as DiscardProjectionResult | null;
    const removed = Boolean(
      result?.deletedProjection || result?.revertedToProposed,
    );
    if (removed) {
      callbacks.onBackToList({ replace: true });
    } else {
      callbacks.onBackToDetail(id);
    }
  }

  return {
    busy,
    saving: approveWrite.isPending || session.committing,
    discarding: discardWrite.isPending,
    save,
    discard,
  };
}
