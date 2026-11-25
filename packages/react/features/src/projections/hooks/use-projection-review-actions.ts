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
import { findNextTarget } from "#rotation";

export interface ReviewActionCallbacks {
  id: string;
  pendingId: string | undefined;
  inWave: boolean;
  isCandidateOutdated: boolean;
  advancing: boolean;
  session: RefineSession;
  setAdvancing: (advancing: boolean) => Promise<void>;
  startFoldIn: () => Promise<void>;
  clearFoldIn: () => Promise<void>;
  onCloseConfirmDiscard: () => void;
  onViewReview: (
    id: string,
    snapshotId: string,
    opts?: { wave?: boolean; replace?: boolean },
  ) => void;
  onApproveSuccess: (id: string) => void;
  onExitWave: () => void;
  onCaughtUp: () => void;
  onReviewNext: (id: string, snapshotId: string) => void;
}

type WriteRunOutcome<T> =
  | { readonly status: "ignored" }
  | { readonly status: "error"; readonly error: Error }
  | ({ readonly status: "success" } & T);

async function advanceWaveTarget(args: {
  id: string;
  setAdvancing: (advancing: boolean) => Promise<void>;
  onApproveSuccess: (id: string) => void;
  onCaughtUp: () => void;
  onReviewNext: (id: string, snapshotId: string) => void;
}) {
  const next = await findNextTarget({ projectionsOnly: true });
  void args.setAdvancing(false);

  if (next.isErr()) {
    toast.error("Couldn't work out what's next", {
      description: next.error.message,
    });
    args.onApproveSuccess(args.id);
    return;
  }
  if (!next.value) {
    args.onCaughtUp();
    return;
  }
  if (next.value.id === args.id) {
    toast.info("Approved — but it needs another pass", {
      description:
        "New context landed after this candidate was generated, so a fresh one is ready to review.",
    });
  }
  if (!next.value.snapshotId) return;
  args.onReviewNext(next.value.id, next.value.snapshotId);
}

async function settleFoldInResult(args: {
  id: string;
  targetId: string;
  mode: "single" | "wave";
  inWave: boolean;
  clearFoldIn: () => Promise<void>;
  setAdvancing: (advancing: boolean) => Promise<void>;
  onViewReview: ReviewActionCallbacks["onViewReview"];
  onApproveSuccess: (id: string) => void;
  onCaughtUp: () => void;
  onReviewNext: (id: string, snapshotId: string) => void;
}) {
  const pendingRes = await getPendingCandidate(args.id);
  void args.clearFoldIn();

  if (pendingRes.isOk() && pendingRes.value?.id === args.targetId) {
    if (args.mode === "wave") {
      toast.info("Approved — fresh candidate ready to review", {
        description:
          "New context landed after this candidate was generated, so a fresh one is ready to review.",
      });
      void args.setAdvancing(false);
      args.onViewReview(args.id, args.targetId, { wave: true, replace: true });
    } else {
      toast.info("Candidate updated with new context");
      args.onViewReview(args.id, args.targetId, {
        wave: args.inWave,
        replace: true,
      });
    }
    return;
  }

  if (args.mode === "single") {
    toast.success("Approved and up to date");
    args.onApproveSuccess(args.id);
  } else {
    await advanceWaveTarget(args);
  }
}

async function runFoldInFlow(args: {
  mode: "single" | "wave";
  callbacks: ReviewActionCallbacks;
  regenerate: () => Promise<WriteRunOutcome<{ readonly id: string }>>;
}) {
  const { callbacks, mode, regenerate } = args;
  await callbacks.startFoldIn();
  const outcome = await regenerate();
  if (outcome.status === "ignored") {
    await callbacks.clearFoldIn();
    if (mode === "wave") await callbacks.setAdvancing(false);
    return;
  }
  if (outcome.status === "error") {
    await callbacks.clearFoldIn();
    if (mode === "wave") await callbacks.setAdvancing(false);
    toast.error("Approved, but couldn't refresh", {
      description: outcome.error.message,
    });
    callbacks.onApproveSuccess(callbacks.id);
    return;
  }
  await settleFoldInResult({
    id: callbacks.id,
    targetId: outcome.id,
    mode,
    inWave: callbacks.inWave,
    clearFoldIn: callbacks.clearFoldIn,
    setAdvancing: callbacks.setAdvancing,
    onViewReview: callbacks.onViewReview,
    onApproveSuccess: callbacks.onApproveSuccess,
    onCaughtUp: callbacks.onCaughtUp,
    onReviewNext: callbacks.onReviewNext,
  });
}

async function runSkipFlow(callbacks: ReviewActionCallbacks) {
  if (!callbacks.id || callbacks.advancing) return;
  await callbacks.setAdvancing(true);
  const next = await findNextTarget({
    skip: [callbacks.id],
    projectionsOnly: true,
  });
  await callbacks.setAdvancing(false);

  if (next.isErr()) {
    toast.error("Couldn't work out what's next", {
      description: next.error.message,
    });
    return;
  }
  if (!next.value?.snapshotId) {
    toast.info("Nothing else to review in wave");
    callbacks.onExitWave();
    return;
  }
  callbacks.onReviewNext(next.value.id, next.value.snapshotId);
}

export function useProjectionReviewActions(callbacks: ReviewActionCallbacks) {
  const client = useKalaidoscopeClient();
  const { id, pendingId, inWave, isCandidateOutdated, advancing, session } =
    callbacks;

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
    if (!id || busy || advancing) return;
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
    callbacks.onViewReview(id, outcome.id, { wave: inWave, replace: true });
  }

  async function handleApproveAndRefresh() {
    if (!id || busy || advancing) return;
    if (!(await runApprove())) return;
    await runFoldInFlow({
      mode: "single",
      callbacks,
      regenerate: () =>
        regenerateWrite.run({ projectionId: id, opts: { foldIn: true } }),
    });
  }

  async function approveAndNext() {
    if (!id || advancing) return;
    await callbacks.setAdvancing(true);
    if (!(await runApprove())) {
      await callbacks.setAdvancing(false);
      return;
    }
    if (isCandidateOutdated) {
      await runFoldInFlow({
        mode: "wave",
        callbacks,
        regenerate: () =>
          regenerateWrite.run({ projectionId: id, opts: { foldIn: true } }),
      });
      return;
    }
    await advanceWaveTarget(callbacks);
  }

  return {
    busy,
    approve,
    handleRefresh: () => handleRefresh(false),
    handleDiscardAndRefresh: () => handleRefresh(true),
    handleApproveAndRefresh,
    skipCurrent: () => runSkipFlow(callbacks),
    approveAndNext,
  };
}
