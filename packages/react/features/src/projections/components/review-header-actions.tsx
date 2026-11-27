import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import { Button } from "@kalaido/primitives/shadcn/button";
import { CheckIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { EditsStatusPill } from "./edits-status-pill";

export interface ReviewHeaderActionsProps {
  pendingEmpty: boolean;
  hasPending: boolean;
  edits: SnapshotEdit[];
  proposedEditsCount: number;
  resolvingAll: boolean;
  canJumpNext: boolean;
  canJumpPrev: boolean;
  onJumpNext: () => void;
  onJumpPrev: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  approveBlocked: boolean;
  saving: boolean;
  busy: boolean;
  onBackToDetail: () => void;
  onRequestDiscard: () => void;
  onApprove: () => void;
}

export function ReviewHeaderActions({
  pendingEmpty,
  hasPending,
  edits,
  proposedEditsCount,
  resolvingAll,
  canJumpNext,
  canJumpPrev,
  onJumpNext,
  onJumpPrev,
  onAcceptAll,
  onRejectAll,
  approveBlocked,
  saving,
  busy,
  onBackToDetail,
  onRequestDiscard,
  onApprove,
}: ReviewHeaderActionsProps) {
  return (
    <>
      {pendingEmpty && (
        <span className="text-meta text-fg-3">
          Draft is empty — ask Kalaido to write a draft before saving.
        </span>
      )}
      <EditsStatusPill
        edits={edits}
        onNext={onJumpNext}
        onPrev={onJumpPrev}
        canNext={canJumpNext}
        canPrev={canJumpPrev}
      />
      {proposedEditsCount > 0 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={busy || resolvingAll}
            onClick={onAcceptAll}
          >
            <CheckIcon />
            Accept all
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={busy || resolvingAll}
            onClick={onRejectAll}
          >
            <XIcon />
            Reject all
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !hasPending}
        onClick={onRequestDiscard}
      >
        <TrashIcon />
        Discard
      </Button>
      <Button variant="outline" size="sm" onClick={onBackToDetail}>
        Come back later
      </Button>
      <Button
        variant="commit"
        size="sm"
        onClick={onApprove}
        disabled={approveBlocked}
      >
        <CheckIcon />
        {saving ? "Saving…" : "Save"}
      </Button>
    </>
  );
}
