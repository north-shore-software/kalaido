import {
  deleteProjection,
  discardProjectionDraft,
  GenerationInFlightError,
  regenerateProjection,
  restoreProjection,
  startProjectionRevise,
  updateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useExternalWrite } from "@kalaido/state/live";
import { toast } from "sonner";

function toastDeleteError(error: Error) {
  if (error instanceof GenerationInFlightError) {
    toast.error("Can't delete while generating", {
      description: error.message,
    });
    return;
  }
  toast.error("Failed to delete projection", { description: error.message });
}

export function useProjectionDetailActions({
  id,
  onBackToList,
  onReviewCandidate,
}: {
  id: string;
  onBackToList: (opts?: { replace?: boolean }) => void;
  onReviewCandidate: (
    id: string,
    snapshotId: string,
    opts?: { replace?: boolean },
  ) => void;
}) {
  const client = useKalaidoscopeClient();

  const deleteWrite = useExternalWrite<string, void>({
    execute: (targetId) => deleteProjection(targetId),
    concurrency: "ignore",
  });
  const restoreWrite = useExternalWrite<string, void>({
    execute: (targetId) => restoreProjection(targetId),
    concurrency: "ignore",
  });
  const regenerateWrite = useExternalWrite<
    { targetId: string; discardExisting?: boolean },
    { readonly id: string }
  >({
    execute: ({ targetId, discardExisting }) =>
      regenerateProjection(targetId, { async: true, discardExisting }),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });
  const discardDraftWrite = useExternalWrite<string, void>({
    execute: async (targetId) =>
      (await discardProjectionDraft(targetId)).map(() => undefined),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });
  const reviseWrite = useExternalWrite<string, { readonly id: string }>({
    execute: (targetId) => startProjectionRevise(targetId),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeCollectionTag(client.baseURL, "projection_refinement"),
    ],
  });
  const renameWrite = useExternalWrite<
    { targetId: string; name: string },
    void
  >({
    execute: async ({ targetId, name }) =>
      (await updateProjection(targetId, { name })).map(() => undefined),
    concurrency: "ignore",
  });

  async function remove() {
    if (!id) return;
    const outcome = await deleteWrite.run(id);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toastDeleteError(outcome.error);
      return;
    }
    onBackToList({ replace: true });
    toast("Projection deleted", {
      description: "Find it under Recently deleted to restore later.",
      action: {
        label: "Undo",
        onClick: () =>
          void restoreWrite.run(id).then((r) => {
            if (r.status === "error") {
              toast.error("Failed to restore", {
                description: r.error.message,
              });
            }
          }),
      },
    });
  }

  async function handleRefresh(opts?: { discardExisting?: boolean }) {
    if (!id) return;
    const outcome = await regenerateWrite.run({
      targetId: id,
      discardExisting: opts?.discardExisting,
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't update", {
        description: outcome.error.message,
      });
      return;
    }
    onReviewCandidate(id, outcome.id);
  }

  async function handleDiscardDraft() {
    if (!id) return;
    const outcome = await discardDraftWrite.run(id);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to discard draft", {
        description: outcome.error.message,
      });
      return;
    }
    onBackToList({ replace: true });
  }

  async function handleRevise() {
    if (!id) return;
    const outcome = await reviseWrite.run(id);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't open revision session", {
        description: outcome.error.message,
      });
      return;
    }
    onReviewCandidate(id, outcome.id);
  }

  async function handleRename(next: string) {
    if (!id) return;
    const outcome = await renameWrite.run({ targetId: id, name: next });
    if (outcome.status === "error") {
      toast.error("Failed to rename", { description: outcome.error.message });
    }
  }

  return {
    regenerating: regenerateWrite.isPending,
    revising: reviseWrite.isPending,
    discardingDraft: discardDraftWrite.isPending,
    remove,
    handleRefresh,
    handleRevise,
    handleDiscardDraft,
    handleRename,
  };
}
