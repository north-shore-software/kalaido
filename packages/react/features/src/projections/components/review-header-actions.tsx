import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import { Button } from "@kalaido/primitives/shadcn/button";
import { CheckIcon } from "@phosphor-icons/react";
import { EditsStatusPill } from "./edits-status-pill";

export interface ReviewHeaderActionsProps {
  pendingEmpty: boolean;
  edits: SnapshotEdit[];
  canJumpNext: boolean;
  canJumpPrev: boolean;
  onJumpNext: () => void;
  onJumpPrev: () => void;
  gateOpen: boolean;
  approveBlocked: boolean;
  hasDraftedLens: boolean;
  onBackToDetail: () => void;
  onApprove: () => void;
}

export function ReviewHeaderActions({
  pendingEmpty,
  edits,
  canJumpNext,
  canJumpPrev,
  onJumpNext,
  onJumpPrev,
  gateOpen,
  approveBlocked,
  hasDraftedLens,
  onBackToDetail,
  onApprove,
}: ReviewHeaderActionsProps) {
  return (
    <>
      {pendingEmpty && (
        <span className="text-meta text-fg-3">
          Empty candidate — refresh the projection to regenerate it.
        </span>
      )}
      <EditsStatusPill
        edits={edits}
        onNext={onJumpNext}
        onPrev={onJumpPrev}
        canNext={canJumpNext}
        canPrev={canJumpPrev}
      />
      <Button variant="outline" size="sm" onClick={onBackToDetail}>
        Come back later
      </Button>
      <Button
        variant="commit"
        size="sm"
        onClick={onApprove}
        disabled={approveBlocked || gateOpen}
      >
        <CheckIcon />
        {hasDraftedLens ? "Approve refined" : "Approve"}
      </Button>
    </>
  );
}
