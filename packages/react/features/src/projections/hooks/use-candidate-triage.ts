import {
  EDIT_TRIAGE_PART_TYPE,
  HAND_EDIT_PART_TYPE,
  REFINE_TARGET_PART_TYPE,
} from "@kalaido/client/kalaidoscope/chat";
import {
  editProjectionCandidate,
  parseProjectionOutput,
  type SnapshotEdit,
  type SnapshotEditStatus,
  updateSnapshotEditStatus,
} from "@kalaido/client/kalaidoscope/projections";
import type { ChatPanelHandle } from "@kalaido/components";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { ProjectionSnapshotWithEdits } from "./use-projection-snapshot";

interface CandidateTriageState {
  highlightedEditId: string | null;
  activeEditId: string | null;
  pendingHandEditId: string | null;
}

type CandidateTriageEvent =
  | { readonly type: "setHighlightedEditId"; readonly id: string | null }
  | { readonly type: "setActiveEditId"; readonly id: string | null }
  | { readonly type: "setPendingHandEditId"; readonly id: string | null };

export interface UseCandidateTriageOptions {
  projectionId?: string;
  pending?: ProjectionSnapshotWithEdits;
  session: RefineSession;
  chatPanelRef: RefObject<ChatPanelHandle | null>;
}

export interface UseCandidateTriageResult {
  edits: SnapshotEdit[];
  proposedEditsCount: number;
  approvedEditsCount: number;
  hasUnresolvedEdits: boolean;
  activeDraft?: string;
  isStreamingPreview: boolean;
  highlightedEditId: string | null;
  activeEditId: string | null;
  canJumpNext: boolean;
  canJumpPrev: boolean;
  jumpToNextEdit: () => void;
  jumpToPrevEdit: () => void;
  handleJumpToChatEvent: (editId: string) => void;
  handleRefinePassage: (passage: string) => void;
  handleRefineEdit: (edit: SnapshotEdit) => void;
  handleEditStatusChange: (
    editId: string,
    status: SnapshotEditStatus,
  ) => Promise<void>;
  handleUndoEdit: (editId: string) => Promise<void>;
  handleHandEdit: (blockPosition: number, newText: string) => Promise<void>;
}

export function useCandidateTriage({
  projectionId,
  pending,
  session,
  chatPanelRef,
}: UseCandidateTriageOptions): UseCandidateTriageResult {
  const client = useKalaidoscopeClient();
  const handlers: ScopeHandlers<CandidateTriageState, CandidateTriageEvent> = {
    setHighlightedEditId: (s, e) => {
      s.highlightedEditId = e.id;
    },
    setActiveEditId: (s, e) => {
      s.activeEditId = e.id;
    },
    setPendingHandEditId: (s, e) => {
      s.pendingHandEditId = e.id;
    },
  };
  const scope = useScope({
    initial: (): CandidateTriageState => ({
      highlightedEditId: null,
      activeEditId: null,
      pendingHandEditId: null,
    }),
    handlers,
  });
  const { highlightedEditId, activeEditId, pendingHandEditId } =
    useScopeState(scope);

  const pendingId = pending?.id;
  const edits: SnapshotEdit[] = useMemo(
    () => (Array.isArray(pending?.edits) ? pending.edits : []),
    [pending?.edits],
  );

  const unresolvedEdits = useMemo(
    () => edits.filter((e) => e.status === "proposed"),
    [edits],
  );
  const currentIndex = activeEditId
    ? unresolvedEdits.findIndex((e) => e.id === activeEditId)
    : -1;

  const canJumpNext =
    unresolvedEdits.length > 0 &&
    (currentIndex === -1 || currentIndex < unresolvedEdits.length - 1);
  const canJumpPrev = currentIndex > 0;

  const scrollToEdit = useCallback((id: string) => {
    const el = document.getElementById(`edit-card-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const jumpToNextEdit = useCallback(() => {
    if (unresolvedEdits.length === 0) return;
    const nextIndex =
      currentIndex === -1
        ? 0
        : Math.min(currentIndex + 1, unresolvedEdits.length - 1);
    const target = unresolvedEdits[nextIndex];
    if (target) {
      void scope.dispatch({ type: "setActiveEditId", id: target.id });
      scrollToEdit(target.id);
    }
  }, [unresolvedEdits, currentIndex, scrollToEdit, scope]);

  const jumpToPrevEdit = useCallback(() => {
    if (unresolvedEdits.length === 0 || currentIndex <= 0) return;
    const prevIndex = currentIndex - 1;
    const target = unresolvedEdits[prevIndex];
    if (target) {
      void scope.dispatch({ type: "setActiveEditId", id: target.id });
      scrollToEdit(target.id);
    }
  }, [unresolvedEdits, currentIndex, scrollToEdit, scope]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        jumpToNextEdit();
      } else if (e.key === "k") {
        e.preventDefault();
        jumpToPrevEdit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [jumpToNextEdit, jumpToPrevEdit]);

  const statusWrite = useExternalWrite<
    {
      projectionId: string;
      pendingId: string;
      editId: string;
      status: SnapshotEditStatus;
    },
    void
  >({
    execute: async ({ projectionId: pId, pendingId: sId, editId, status }) =>
      (await updateSnapshotEditStatus(pId, sId, editId, status)).map(
        () => undefined,
      ),
    concurrency: "allow",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
    ],
  });

  const handEditWrite = useExternalWrite<
    {
      projectionId: string;
      pendingId: string;
      blockPosition: number;
      newText: string;
    },
    { readonly id: string }
  >({
    execute: async ({
      projectionId: pId,
      pendingId: sId,
      blockPosition,
      newText,
    }) =>
      (await editProjectionCandidate(pId, sId, { blockPosition, newText })).map(
        (r) => ({ id: r.edit.id }),
      ),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
    ],
  });

  // Pure CQRS hand-edit chat notice: once the newly-created edit arrives in
  // live `pending.edits`, emit the system notice and clear the pending id.
  useEffect(() => {
    if (!pendingHandEditId || !projectionId || !pendingId) return;
    const edit = edits.find((e) => e.id === pendingHandEditId);
    if (!edit) return;
    void scope.dispatch({ type: "setPendingHandEditId", id: null });
    const noticeData = {
      editId: edit.id,
      sequence: edit.sequence,
      before: edit.contentBefore,
      after: edit.contentAfter,
    };
    const noticeId = `hand-edit-${edit.id}`;
    if (!session.started) {
      void session.start({
        parentId: projectionId,
        snapshotId: pendingId,
        systemNotices: [
          {
            id: noticeId,
            type: HAND_EDIT_PART_TYPE,
            data: noticeData,
          },
        ],
      });
    } else {
      chatPanelRef.current?.appendSystemNotice(
        HAND_EDIT_PART_TYPE,
        noticeData,
        noticeId,
      );
      chatPanelRef.current?.focus();
    }
  }, [
    pendingHandEditId,
    edits,
    projectionId,
    pendingId,
    session,
    chatPanelRef,
    scope,
  ]);

  const proposedEditsCount = edits.filter(
    (e) => e.status === "proposed",
  ).length;
  const approvedEditsCount = edits.filter(
    (e) => e.status === "approved",
  ).length;
  const hasUnresolvedEdits = proposedEditsCount > 0;

  const refinedDraft = session.preview;
  const isStreamingPreview = session.phase === "applying";
  const candidateDraft = pending
    ? (pending.output_draft ?? parseProjectionOutput(pending.output).content)
    : undefined;
  const activeDraft =
    candidateDraft != null
      ? isStreamingPreview
        ? refinedDraft || candidateDraft
        : candidateDraft
      : refinedDraft;

  const handleJumpToChatEvent = useCallback(
    (editId: string) => {
      void scope.dispatch({ type: "setHighlightedEditId", id: editId });
    },
    [scope],
  );

  const handleRefinePassage = useCallback(
    async (passage: string, editId?: string) => {
      const noticeData: { passage: string; editId?: string } = { passage };
      if (editId) {
        noticeData.editId = editId;
      }
      if (!session.started && projectionId && pendingId) {
        await session.start({
          parentId: projectionId,
          snapshotId: pendingId,
          systemNotices: [
            {
              type: REFINE_TARGET_PART_TYPE,
              data: noticeData,
            },
          ],
        });
        return;
      }
      chatPanelRef.current?.appendSystemNotice(
        REFINE_TARGET_PART_TYPE,
        noticeData,
      );
      chatPanelRef.current?.focus();
    },
    [session, projectionId, pendingId, chatPanelRef],
  );

  const handleRefineEdit = useCallback(
    (edit: SnapshotEdit) => {
      const passage = edit.contentAfter || edit.contentBefore;
      if (passage) {
        void handleRefinePassage(passage, edit.id);
      }
    },
    [handleRefinePassage],
  );

  const handleEditStatusChange = useCallback(
    async (editId: string, status: SnapshotEditStatus) => {
      if (!projectionId || !pendingId) return;
      const outcome = await statusWrite.run({
        projectionId,
        pendingId,
        editId,
        status,
      });
      if (outcome.status === "ignored") return;
      if (outcome.status === "error") {
        toast.error("Failed to update edit", {
          description: outcome.error.message,
        });
        return;
      }
      const edit = edits.find((e) => e.id === editId);
      const seq = edit?.sequence ?? 1;
      const noticeData = { editId, sequence: seq, status };
      const noticeId = `triage-edit-${editId}-${status}`;
      if (!session.started) {
        await session.start({
          parentId: projectionId,
          snapshotId: pendingId,
          systemNotices: [
            {
              id: noticeId,
              type: EDIT_TRIAGE_PART_TYPE,
              data: noticeData,
            },
          ],
        });
      } else {
        chatPanelRef.current?.appendSystemNotice(
          EDIT_TRIAGE_PART_TYPE,
          noticeData,
          noticeId,
        );
      }
    },
    [projectionId, pendingId, statusWrite, edits, session, chatPanelRef],
  );

  const handleHandEdit = useCallback(
    async (blockPosition: number, newText: string): Promise<void> => {
      if (!projectionId || !pendingId) return;
      const outcome = await handEditWrite.run({
        projectionId,
        pendingId,
        blockPosition,
        newText,
      });
      if (outcome.status === "ignored") return;
      if (outcome.status === "error") {
        toast.error("Failed to apply edit", {
          description: outcome.error.message,
        });
        return;
      }
      void scope.dispatch({ type: "setPendingHandEditId", id: outcome.id });
    },
    [projectionId, pendingId, handEditWrite, scope],
  );

  const handleUndoEdit = useCallback(
    async (editId: string) => {
      await handleEditStatusChange(editId, "proposed");
    },
    [handleEditStatusChange],
  );

  return {
    edits,
    proposedEditsCount,
    approvedEditsCount,
    hasUnresolvedEdits,
    activeDraft,
    isStreamingPreview,
    highlightedEditId,
    activeEditId,
    canJumpNext,
    canJumpPrev,
    jumpToNextEdit,
    jumpToPrevEdit,
    handleJumpToChatEvent,
    handleRefinePassage,
    handleRefineEdit,
    handleEditStatusChange,
    handleUndoEdit,
    handleHandEdit,
  };
}
