import { useCallback, useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";
import {
  EDIT_TRIAGE_PART_TYPE,
  HAND_EDIT_PART_TYPE,
  REFINE_TARGET_PART_TYPE,
} from "@/api/kalaidoscope/chat";
import {
  type SnapshotEdit,
  type SnapshotEditStatus,
  editProjectionCandidate,
  updateSnapshotEditStatus,
} from "@/api/kalaidoscope/projections";
import type { ChatPanelHandle } from "@/components/kalaido";
import {
  type ProjectionSnapshotWithEdits,
  parseProjectionOutput,
} from "@/hooks/use-projection-snapshot";
import type { RefineSession } from "@/hooks/use-refine-session";

export interface UseCandidateTriageOptions {
  projectionId?: string;
  pending?: ProjectionSnapshotWithEdits;
  mutate: () => Promise<unknown>;
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
  mutate,
  session,
  chatPanelRef,
}: UseCandidateTriageOptions): UseCandidateTriageResult {
  const [highlightedEditId, setHighlightedEditId] = useState<string | null>(
    null,
  );
  const [activeEditId, setActiveEditId] = useState<string | null>(null);

  const pendingId = pending?.id;
  const edits: SnapshotEdit[] = Array.isArray(pending?.edits)
    ? pending.edits
    : [];

  const unresolvedEdits = edits.filter((e) => e.status === "proposed");
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
      setActiveEditId(target.id);
      scrollToEdit(target.id);
    }
  }, [unresolvedEdits, currentIndex, scrollToEdit]);

  const jumpToPrevEdit = useCallback(() => {
    if (unresolvedEdits.length === 0 || currentIndex <= 0) return;
    const prevIndex = currentIndex - 1;
    const target = unresolvedEdits[prevIndex];
    if (target) {
      setActiveEditId(target.id);
      scrollToEdit(target.id);
    }
  }, [unresolvedEdits, currentIndex, scrollToEdit]);

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

  const handleJumpToChatEvent = useCallback((editId: string) => {
    setHighlightedEditId(editId);
  }, []);

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
        handleRefinePassage(passage, edit.id);
      }
    },
    [handleRefinePassage],
  );

  const handleEditStatusChange = useCallback(
    async (editId: string, status: SnapshotEditStatus) => {
      if (!projectionId || !pendingId) return;
      const res = await updateSnapshotEditStatus(
        projectionId,
        pendingId,
        editId,
        status,
      );
      if (res.isErr()) {
        toast.error("Failed to update edit", {
          description: res.error.message,
        });
        return;
      }
      await mutate();
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
    [projectionId, pendingId, mutate, edits, session, chatPanelRef],
  );

  const handleHandEdit = useCallback(
    async (blockPosition: number, newText: string): Promise<void> => {
      if (!projectionId || !pendingId) return;
      const res = await editProjectionCandidate(projectionId, pendingId, {
        blockPosition,
        newText,
      });
      if (res.isErr()) {
        toast.error("Failed to apply edit", {
          description: res.error.message,
        });
        return;
      }
      await mutate();
      const edit = res.value.edit;
      const noticeData = {
        editId: edit.id,
        sequence: edit.sequence,
        before: edit.contentBefore,
        after: edit.contentAfter,
      };
      const noticeId = `hand-edit-${edit.id}`;
      if (!session.started) {
        await session.start({
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
    },
    [projectionId, pendingId, mutate, session, chatPanelRef],
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
