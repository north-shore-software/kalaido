import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import {
  type ChatPanelHandle,
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import type { RefObject } from "react";
import type { UseCandidateTriageResult } from "../hooks/use-candidate-triage";
import { ProjectionCanvasPane } from "./projection-canvas-pane";

export interface ReviewCanvasColumnProps {
  hasPending: boolean;
  currentContent: string | undefined;
  triage: UseCandidateTriageResult;
  busy: boolean;
  snapshotId: string;
}

export function ReviewCanvasColumn({
  hasPending,
  currentContent,
  triage,
  busy,
  snapshotId,
}: ReviewCanvasColumnProps) {
  if (hasPending) {
    return (
      <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
        <ProjectionCanvasPane
          content={currentContent}
          triage={triage}
          busy={busy}
          resetKey={snapshotId}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
      <div className="flex flex-1 items-center justify-center">
        <p className="text-body-sm text-fg-2">
          Draft not found — it may have already been saved or discarded.
        </p>
      </div>
    </div>
  );
}

export interface ReviewRefineColumnProps {
  chatPanelRef: RefObject<ChatPanelHandle | null>;
  session: RefineSession;
  context: ContextItem[];
  refineInput: string;
  hasPending: boolean;
  highlightedEditId: string | null;
  edits: SnapshotEdit[];
  onUndoEdit: (editId: string) => void;
  onMention: (item: ContextItem) => void;
  onContextChange: (next: ContextItem[]) => void;
  onInputChange: (next: string) => void;
  onStartRefine: () => void;
}

export function ReviewRefineColumn({
  chatPanelRef,
  session,
  context,
  refineInput,
  hasPending,
  highlightedEditId,
  edits,
  onUndoEdit,
  onMention,
  onContextChange,
  onInputChange,
  onStartRefine,
}: ReviewRefineColumnProps) {
  return (
    <div className="flex min-w-0 flex-[1.05] flex-col bg-surface-1">
      {session.started ? (
        <RefineChatPanel
          ref={chatPanelRef}
          session={session}
          title="Edit with chat"
          context={context}
          onMention={onMention}
          onContextChange={onContextChange}
          notifyOnContextChange
          entity="projection"
          highlightedEditId={highlightedEditId}
          edits={edits}
          onUndoEdit={onUndoEdit}
          placeholder="Tell Kalaido what to change…"
          input={refineInput}
          onInputChange={onInputChange}
        />
      ) : (
        <RefineComposer
          title="Edit with chat"
          helperText="Tell Kalaido what to change about this draft before saving."
          helperTextClassName="max-w-[80%]"
          value={refineInput}
          onChange={onInputChange}
          placeholder="Tell Kalaido what to change…"
          disabled={!hasPending}
          busy={session.creating}
          onSubmit={onStartRefine}
          onMention={onMention}
          beforeInput={
            <ContextBar
              items={context}
              onChange={onContextChange}
              entity="projection"
            />
          }
        />
      )}
    </div>
  );
}
