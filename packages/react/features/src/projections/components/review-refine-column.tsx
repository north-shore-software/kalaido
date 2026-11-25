import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import {
  type ChatPanelHandle,
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { DecisionCard } from "@kalaido/primitives/kalaido";
import { WarningIcon } from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { UseCandidateTriageResult } from "../hooks/use-candidate-triage";
import { ProjectionCanvasPane } from "./projection-canvas-pane";

export interface ReviewCanvasColumnProps {
  hasPending: boolean;
  currentContent: string | undefined;
  triage: UseCandidateTriageResult;
  busy: boolean;
  frozen: boolean;
  snapshotId: string;
  foldingIn: boolean;
  advancing: boolean;
}

export function ReviewCanvasColumn({
  hasPending,
  currentContent,
  triage,
  busy,
  frozen,
  snapshotId,
  foldingIn,
  advancing,
}: ReviewCanvasColumnProps) {
  if (hasPending) {
    return (
      <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
        <ProjectionCanvasPane
          content={currentContent}
          triage={triage}
          busy={busy}
          frozen={frozen}
          resetKey={snapshotId}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
      {foldingIn || advancing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-body-sm text-fg-2">Approved.</p>
          <p className="text-meta text-fg-3">
            {foldingIn
              ? "Folding the new context into a fresh candidate. Your conversation carries over to it."
              : "Working out what's next and generating its candidate…"}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-body-sm text-fg-2">
            Candidate not found — it may have already been approved.
          </p>
        </div>
      )}
    </div>
  );
}

export interface ReviewRefineColumnProps {
  chatPanelRef: RefObject<ChatPanelHandle | null>;
  session: RefineSession;
  context: ContextItem[];
  refineInput: string;
  hasPending: boolean;
  gateOpen: boolean;
  gateDescription: string;
  isCandidateEngaged: boolean;
  foldingIn: boolean;
  busy: boolean;
  approveBlocked: boolean;
  highlightedEditId: string | null;
  edits: SnapshotEdit[];
  onUndoEdit: (editId: string) => void;
  onMention: (item: ContextItem) => void;
  onContextChange: (next: ContextItem[]) => void;
  onInputChange: (next: string) => void;
  onStartRefine: () => void;
  onFoldIn: () => void;
  onRequestStartOver: () => void;
  onRefresh: () => void;
}

export function ReviewRefineColumn({
  chatPanelRef,
  session,
  context,
  refineInput,
  hasPending,
  gateOpen,
  gateDescription,
  isCandidateEngaged,
  foldingIn,
  busy,
  approveBlocked,
  highlightedEditId,
  edits,
  onUndoEdit,
  onMention,
  onContextChange,
  onInputChange,
  onStartRefine,
  onFoldIn,
  onRequestStartOver,
  onRefresh,
}: ReviewRefineColumnProps) {
  const gateCard = gateOpen ? (
    <DecisionCard
      icon={<WarningIcon className="size-4 shrink-0 text-drifting-ink" />}
      title="Candidate is out of date"
      busy={busy}
      description={gateDescription}
      options={
        isCandidateEngaged
          ? [
              {
                id: "fold-in",
                label: "Approve & fold in",
                variant: "commit",
                disabled: approveBlocked,
                onSelect: onFoldIn,
              },
              {
                id: "start-over",
                label: "Start over",
                variant: "destructive",
                onSelect: onRequestStartOver,
              },
            ]
          : [
              {
                id: "refresh",
                label: "Refresh",
                variant: "commit",
                onSelect: onRefresh,
              },
            ]
      }
    />
  ) : null;

  return (
    <div className="flex min-w-0 flex-[1.05] flex-col bg-surface-1">
      {session.started ? (
        <RefineChatPanel
          ref={chatPanelRef}
          session={session}
          title="Refine with chat"
          context={context}
          onMention={onMention}
          onContextChange={onContextChange}
          entity="projection"
          highlightedEditId={highlightedEditId}
          edits={edits}
          onUndoEdit={onUndoEdit}
          placeholder="Tell Kalaido what to change…"
          input={refineInput}
          onInputChange={onInputChange}
          disabled={gateOpen || foldingIn}
          trailing={gateCard}
        />
      ) : (
        <RefineComposer
          title="Refine with chat"
          helperText="Tell Kalaido what to change about this candidate to refine it before approving."
          helperTextClassName="max-w-[80%]"
          value={refineInput}
          onChange={onInputChange}
          placeholder="Tell Kalaido what to change…"
          disabled={!hasPending || gateOpen || foldingIn}
          busy={session.creating}
          onSubmit={onStartRefine}
          onMention={onMention}
          beforeInput={
            <div inert={gateOpen || foldingIn}>
              <ContextBar
                items={context}
                onChange={onContextChange}
                entity="projection"
              />
            </div>
          }
        >
          {gateCard}
        </RefineComposer>
      )}
    </div>
  );
}
