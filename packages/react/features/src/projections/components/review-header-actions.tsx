import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import { StatusPill } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react";
import { EditsStatusPill } from "./edits-status-pill";

export interface ReviewHeaderActionsProps {
  inWave: boolean;
  pendingEmpty: boolean;
  edits: SnapshotEdit[];
  canJumpNext: boolean;
  canJumpPrev: boolean;
  onJumpNext: () => void;
  onJumpPrev: () => void;
  busy: boolean;
  advancing: boolean;
  gateOpen: boolean;
  approveBlocked: boolean;
  hasDraftedLens: boolean;
  onSkip: () => void;
  onExitWave: () => void;
  onBackToDetail: () => void;
  onApprove: () => void;
  onApproveAndNext: () => void;
}

export function ReviewHeaderActions({
  inWave,
  pendingEmpty,
  edits,
  canJumpNext,
  canJumpPrev,
  onJumpNext,
  onJumpPrev,
  busy,
  advancing,
  gateOpen,
  approveBlocked,
  hasDraftedLens,
  onSkip,
  onExitWave,
  onBackToDetail,
  onApprove,
  onApproveAndNext,
}: ReviewHeaderActionsProps) {
  return (
    <>
      {pendingEmpty && (
        <span className="text-meta text-fg-3">
          Empty candidate — refresh the projection to regenerate it.
        </span>
      )}
      {inWave && (
        <StatusPill kind="cyan" dot>
          Wave
        </StatusPill>
      )}
      <EditsStatusPill
        edits={edits}
        onNext={onJumpNext}
        onPrev={onJumpPrev}
        canNext={canJumpNext}
        canPrev={canJumpPrev}
      />
      {inWave ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || advancing || gateOpen}
            onClick={onSkip}
          >
            Skip
          </Button>
          <Button variant="outline" size="sm" onClick={onExitWave}>
            Exit wave
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onApprove}
            disabled={approveBlocked || gateOpen}
          >
            <CheckIcon />
            Approve & exit
          </Button>
          <Button
            variant="commit"
            size="sm"
            onClick={onApproveAndNext}
            disabled={approveBlocked || gateOpen}
          >
            {advancing ? "Finding next…" : "Approve & next"}
            <ArrowRightIcon />
          </Button>
        </>
      ) : (
        <>
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
      )}
    </>
  );
}
