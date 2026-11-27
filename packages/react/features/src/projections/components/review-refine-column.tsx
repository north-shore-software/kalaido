import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";
import {
  type ChatPanelHandle,
  ContextBar,
  type ContextItem,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { Pill, StatusPill } from "@kalaido/primitives/kalaido";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { ArrowsClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { UseCandidateTriageResult } from "../hooks/use-candidate-triage";
import { ProjectionCanvasPane } from "./projection-canvas-pane";

export interface ReviewCanvasColumnProps {
  hasPending: boolean;
  isGenerating: boolean;
  updateError: string | null;
  retrying: boolean;
  onRetryUpdate: () => void;
  onBackToProjection: () => void;
  currentContent: string | undefined;
  triage: UseCandidateTriageResult;
  busy: boolean;
  snapshotId: string;
}

function GeneratingCanvasSkeleton() {
  return (
    <>
      <PaneHeader
        label="Draft"
        status={
          <Pill tone="primary" dot>
            updating…
          </Pill>
        }
      />
      <section
        className="flex flex-1 flex-col gap-5 overflow-y-auto p-6"
        aria-busy="true"
        aria-label="Updating draft"
      >
        <div className="h-6 w-2/5 animate-pulse rounded-none bg-surface-2" />
        <div className="flex flex-col gap-2.5">
          <div className="h-3.5 w-full animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-11/12 animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-4/5 animate-pulse rounded-none bg-surface-2" />
        </div>
        <div className="h-5 w-1/3 animate-pulse rounded-none bg-surface-2" />
        <div className="flex flex-col gap-2.5">
          <div className="h-3.5 w-full animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-5/6 animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-11/12 animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-3/4 animate-pulse rounded-none bg-surface-2" />
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="h-3.5 w-full animate-pulse rounded-none bg-surface-2" />
          <div className="h-3.5 w-2/3 animate-pulse rounded-none bg-surface-2" />
        </div>
      </section>
    </>
  );
}

function UpdateErrorCanvas({
  error,
  retrying,
  onRetryUpdate,
  onBackToProjection,
}: {
  error: string;
  retrying: boolean;
  onRetryUpdate: () => void;
  onBackToProjection: () => void;
}) {
  return (
    <>
      <PaneHeader
        label="Draft"
        status={<StatusPill kind="critical">error</StatusPill>}
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-2">
          <WarningCircleIcon className="size-6 text-critical-ink" />
          <p className="text-item font-semibold text-fg-1">
            Update couldn&apos;t complete
          </p>
          <p className="text-body-sm text-fg-3">{error}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={onRetryUpdate}
          >
            <ArrowsClockwiseIcon />
            {retrying ? "Retrying…" : "Retry update"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onBackToProjection}>
            Back to projection
          </Button>
        </div>
      </div>
    </>
  );
}

export function ReviewCanvasColumn({
  hasPending,
  isGenerating,
  updateError,
  retrying,
  onRetryUpdate,
  onBackToProjection,
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

  if (isGenerating) {
    return (
      <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
        <GeneratingCanvasSkeleton />
      </div>
    );
  }

  if (updateError) {
    return (
      <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
        <UpdateErrorCanvas
          error={updateError}
          retrying={retrying}
          onRetryUpdate={onRetryUpdate}
          onBackToProjection={onBackToProjection}
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
  isGenerating: boolean;
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
  isGenerating,
  highlightedEditId,
  edits,
  onUndoEdit,
  onMention,
  onContextChange,
  onInputChange,
  onStartRefine,
}: ReviewRefineColumnProps) {
  if (isGenerating && !hasPending) {
    return (
      <div className="flex min-w-0 flex-[1.05] flex-col bg-surface-1">
        <PaneHeader label="Edit with chat" />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex items-center gap-2.5 text-body-sm text-fg-3">
            <ArrowsClockwiseIcon className="size-4 shrink-0 animate-spin text-fg-3" />
            <span>Reviewing sources and drafting updates…</span>
          </div>
        </div>
      </div>
    );
  }

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
