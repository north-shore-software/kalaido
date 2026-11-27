import {
  approveProjectionCandidate,
  getPendingCandidate,
  regenerateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { useExternalWrite } from "@kalaido/state/live";
import { toast } from "sonner";

export interface ReviewActionCallbacks {
  id: string;
  pendingId: string | undefined;
  session: RefineSession;
  startFoldIn: () => Promise<void>;
  clearFoldIn: () => Promise<void>;
  onCloseConfirmDiscard: () => void;
  onViewReview: (
    id: string,
    snapshotId: string,
    opts?: { replace?: boolean },
  ) => void;
  onApproveSuccess: (id: string) => void;
}

type WriteRunOutcome<T> =
  | { readonly status: "ignored" }
  | { readonly status: "error"; readonly error: Error }
  | ({ readonly status: "success" } & T);

async function settleFoldInResult(args: {
  id: string;
  targetId: string;
  clearFoldIn: () => Promise<void>;
  onViewReview: ReviewActionCallbacks["onViewReview"];
  onApproveSuccess: (id: string) => void;
}) {
  const pendingRes = await getPendingCandidate(args.id);
  void args.clearFoldIn();

  if (pendingRes.isOk() && pendingRes.value?.id === args.targetId) {
    toast.info("Candidate updated with new context");
    args.onViewReview(args.id, args.targetId, { replace: true });
    return;
  }

  toast.success("Approved and up to date");
  args.onApproveSuccess(args.id);
}

async function runFoldInFlow(args: {
  callbacks: ReviewActionCallbacks;
  regenerate: () => Promise<WriteRunOutcome<{ readonly id: string }>>;
}) {
  const { callbacks, regenerate } = args;
  await callbacks.startFoldIn();
  const outcome = await regenerate();
  if (outcome.status === "ignored") {
    await callbacks.clearFoldIn();
    return;
  }
  if (outcome.status === "error") {
    await callbacks.clearFoldIn();
    toast.error("Approved, but couldn't refresh", {
      description: outcome.error.message,
    });
    callbacks.onApproveSuccess(callbacks.id);
    return;
  }
  await settleFoldInResult({
    id: callbacks.id,
    targetId: outcome.id,
    clearFoldIn: callbacks.clearFoldIn,
    onViewReview: callbacks.onViewReview,
    onApproveSuccess: callbacks.onApproveSuccess,
  });
}

export function useProjectionReviewActions(callbacks: ReviewActionCallbacks) {
  const client = useKalaidoscopeClient();
  const { id, pendingId, session } = callbacks;

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

  const regenerateWrite = useExternalWrite<
    {
      projectionId: string;
      opts?: { discardEngaged?: boolean; foldIn?: boolean };
    },
    { readonly id: string }
  >({
    execute: ({ projectionId, opts }) =>
      regenerateProjection(projectionId, false, opts),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const busy =
    approveWrite.isPending || regenerateWrite.isPending || session.committing;

  async function runApprove(): Promise<boolean> {
    if (!id || !pendingId || busy) return false;
    if (session.started && session.hasDraftedLens) {
      return session.commit(id);
    }
    const outcome = await approveWrite.run({
      projectionId: id,
      snapshotId: pendingId,
    });
    if (outcome.status === "ignored") return false;
    if (outcome.status === "error") {
      console.error("review: approve failed", outcome.error);
      toast.error("Failed to approve", { description: outcome.error.message });
      return false;
    }
    return true;
  }

  async function approve() {
    if (id && (await runApprove())) {
      callbacks.onApproveSuccess(id);
    }
  }

  async function handleRefresh(discardEngaged?: boolean) {
    if (!id || busy) return;
    const outcome = await regenerateWrite.run({
      projectionId: id,
      opts: discardEngaged ? { discardEngaged: true } : undefined,
    });
    if (discardEngaged) callbacks.onCloseConfirmDiscard();
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't refresh", { description: outcome.error.message });
      return;
    }
    callbacks.onViewReview(id, outcome.id, { replace: true });
  }

  async function handleApproveAndRefresh() {
    if (!id || busy) return;
    if (!(await runApprove())) return;
    await runFoldInFlow({
      callbacks,
      regenerate: () =>
        regenerateWrite.run({ projectionId: id, opts: { foldIn: true } }),
    });
  }

  return {
    busy,
    approve,
    handleRefresh: () => handleRefresh(false),
    handleDiscardAndRefresh: () => handleRefresh(true),
    handleApproveAndRefresh,
  };
}
