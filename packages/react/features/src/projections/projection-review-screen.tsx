import {
  parseContextSpec,
  specToItems,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import { parseProjectionOutput } from "@kalaido/client/kalaidoscope/projections";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  type ChatPanelHandle,
  type ContextItem,
  PageHeader,
} from "@kalaido/components";
import { useRotationStatus } from "@kalaido/hooks/use-rotation-status";
import { ConfirmDialog } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { WarningIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ReviewHeaderActions } from "./components/review-header-actions";
import {
  ReviewCanvasColumn,
  ReviewRefineColumn,
} from "./components/review-refine-column";
import { useCandidateTriage } from "./hooks/use-candidate-triage";
import { useProjectionRefinement } from "./hooks/use-projection-refinement";
import { useProjectionReviewActions } from "./hooks/use-projection-review-actions";
import { useProjectionSnapshot } from "./hooks/use-projection-snapshot";
import {
  deriveReviewViewState,
  formatDiscardDescription,
} from "./outdated-reason";

interface ReviewWorkflowState {
  advancing: boolean;
  foldingIn: boolean;
  context: ContextItem[];
  refineInput: string;
}

type ReviewWorkflowEvent =
  | { readonly type: "setAdvancing"; readonly advancing: boolean }
  | { readonly type: "startFoldIn" }
  | { readonly type: "clearFoldIn" }
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | { readonly type: "mentionContext"; readonly item: ContextItem }
  | { readonly type: "setRefineInput"; readonly input: string };

export interface ProjectionReviewScreenProps {
  id: string;
  snapshotId: string;
  inWave?: boolean;
  onViewReview: (
    id: string,
    snapshotId: string,
    opts?: { wave?: boolean; replace?: boolean },
  ) => void;
  renderCandidateRedirect?: (
    id: string,
    snapshotId: string,
    opts: { wave: boolean },
  ) => ReactNode;
  onApproveSuccess: (id: string) => void;
  onBackToDetail: (id: string) => void;
  onExitWave: () => void;
  onCaughtUp: () => void;
  onReviewNext: (id: string, snapshotId: string) => void;
}

const REVIEW_HANDLERS: ScopeHandlers<ReviewWorkflowState, ReviewWorkflowEvent> =
  {
    setAdvancing: (s, e) => {
      s.advancing = e.advancing;
    },
    startFoldIn: (s) => {
      s.foldingIn = true;
    },
    clearFoldIn: (s) => {
      s.foldingIn = false;
    },
    setContext: (s, e) => {
      s.context = e.context;
    },
    mentionContext: (s, e) => {
      s.context = withContextItem(s.context, e.item);
    },
    setRefineInput: (s, e) => {
      s.refineInput = e.input;
    },
  };

/**
 * "Approve & next" moves between projections, and a fold-in ("Approve & fold
 * in" on the outdated-candidate card) moves between candidates of the same
 * projection, without leaving this route — key the page on the candidate to
 * force a clean mount.
 */
export function ProjectionReviewScreen(props: ProjectionReviewScreenProps) {
  return (
    <ProjectionReviewScreenInner
      key={`${props.id}:${props.snapshotId}`}
      {...props}
    />
  );
}

function ProjectionReviewScreenInner({
  id,
  snapshotId,
  inWave = false,
  onViewReview,
  renderCandidateRedirect,
  onApproveSuccess,
  onBackToDetail,
  onExitWave,
  onCaughtUp,
  onReviewNext,
}: ProjectionReviewScreenProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const scope = useScope({
    initial: (): ReviewWorkflowState => ({
      advancing: false,
      foldingIn: false,
      context: [WHOLE_SCOPE_ITEM],
      refineInput: "",
    }),
    handlers: REVIEW_HANDLERS,
  });

  const { advancing, foldingIn, context, refineInput } = useScopeState(scope);
  const { projection, snapshots, liveSnapshot } = useProjectionSnapshot(id);

  const pending = snapshots.find((s) => s.status === "pending_review");
  const pendingId = pending?.id;

  const { byId: statusById } = useRotationStatus();
  const candStatus = id ? statusById.get(id)?.candidate : undefined;

  const ctxInitedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || ctxInitedFor.current === pending.id) return;
    ctxInitedFor.current = pending.id;
    const spec = parseContextSpec(pending.context_spec);
    void scope.dispatch({
      type: "setContext",
      context: spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM],
    });
  }, [pending, scope]);

  const {
    session,
    openRefinement,
    context: refineContext,
    resumed,
  } = useProjectionRefinement({
    parentId: id,
    snapshotId: pendingId ?? "",
    enabled: !!pendingId,
  });
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  const ctxResumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!resumed || !openRefinement || refineContext.length === 0) return;
    if (ctxResumedFor.current === openRefinement.id) return;
    ctxResumedFor.current = openRefinement.id;
    void scope.dispatch({ type: "setContext", context: refineContext });
  }, [resumed, openRefinement, refineContext, scope]);

  const triage = useCandidateTriage({
    projectionId: id,
    pending,
    session,
    chatPanelRef,
  });

  const isCandidateOutdated = Boolean(
    pendingId && candStatus?.id === pendingId && candStatus.outdated,
  );

  const actions = useProjectionReviewActions({
    id,
    pendingId,
    inWave,
    isCandidateOutdated,
    advancing,
    session,
    setAdvancing: (next) =>
      scope.dispatch({ type: "setAdvancing", advancing: next }),
    startFoldIn: () => scope.dispatch({ type: "startFoldIn" }),
    clearFoldIn: () => scope.dispatch({ type: "clearFoldIn" }),
    onCloseConfirmDiscard: () => setConfirmDiscard(false),
    onViewReview,
    onApproveSuccess,
    onExitWave,
    onCaughtUp,
    onReviewNext,
  });

  async function startRefine() {
    const text = refineInput.trim();
    if (!text || !id || !pendingId || session.creating) return;
    await session.start({
      parentId: id,
      prompt: text,
      snapshotId: pendingId,
      context: context as ContextItem[],
    });
  }

  const generatedAt = pending
    ? formatShortDateTime(pending.generated_at || pending.created)
    : "";
  const title = projection?.name || "Projection";
  const view = deriveReviewViewState({
    pendingId,
    pendingGeneratedAt: generatedAt,
    candStatus,
    previewLength: session.preview.length,
    activeDraft: triage.activeDraft,
    busy: actions.busy,
    advancing,
    sessionPhase: session.phase,
    hasUnresolvedEdits: triage.hasUnresolvedEdits,
    proposedEditsCount: triage.proposedEditsCount,
    edits: triage.edits,
    inWave,
    title,
  });
  const currentContent = liveSnapshot
    ? parseProjectionOutput(liveSnapshot.output).content
    : undefined;
  const anyBusy = actions.busy || advancing;

  if (pendingId && pendingId !== snapshotId && renderCandidateRedirect) {
    return renderCandidateRedirect(id, pendingId, { wave: inWave });
  }

  return (
    <>
      <PageHeader
        title={view.headerTitle}
        crumb={view.headerCrumb}
        actions={
          <ReviewHeaderActions
            inWave={inWave}
            pendingEmpty={view.pendingEmpty}
            edits={triage.edits}
            canJumpNext={triage.canJumpNext}
            canJumpPrev={triage.canJumpPrev}
            onJumpNext={triage.jumpToNextEdit}
            onJumpPrev={triage.jumpToPrevEdit}
            busy={actions.busy}
            advancing={advancing}
            gateOpen={view.gateOpen}
            approveBlocked={view.approveBlocked}
            hasDraftedLens={session.hasDraftedLens}
            onSkip={() => void actions.skipCurrent()}
            onExitWave={onExitWave}
            onBackToDetail={() => onBackToDetail(id)}
            onApprove={() => void actions.approve()}
            onApproveAndNext={() => void actions.approveAndNext()}
          />
        }
      />
      <PageCard>
        {view.gateOpen && (
          <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5 text-body-sm">
            <div className="flex items-center gap-2 text-fg-2">
              <WarningIcon className="size-4 shrink-0 text-drifting-ink" />
              <span>
                Candidate is out of date ({view.outdatedReason}) · Generated{" "}
                {generatedAt}
              </span>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <ReviewCanvasColumn
            hasPending={!!pending}
            currentContent={currentContent}
            triage={triage}
            busy={anyBusy}
            frozen={view.gateOpen}
            snapshotId={snapshotId}
            foldingIn={foldingIn}
            advancing={advancing}
          />
          <ReviewRefineColumn
            chatPanelRef={chatPanelRef}
            session={session}
            context={context as ContextItem[]}
            refineInput={refineInput}
            hasPending={!!pending}
            gateOpen={view.gateOpen}
            gateDescription={view.gateDescription}
            isCandidateEngaged={view.isCandidateEngaged}
            foldingIn={foldingIn}
            busy={anyBusy}
            approveBlocked={view.approveBlocked}
            highlightedEditId={triage.highlightedEditId}
            edits={triage.edits}
            onUndoEdit={triage.handleUndoEdit}
            onMention={(item) =>
              void scope.dispatch({ type: "mentionContext", item })
            }
            onContextChange={(next) =>
              void scope.dispatch({ type: "setContext", context: next })
            }
            onInputChange={(next) =>
              void scope.dispatch({ type: "setRefineInput", input: next })
            }
            onStartRefine={() => void startRefine()}
            onFoldIn={() =>
              void (inWave
                ? actions.approveAndNext()
                : actions.handleApproveAndRefresh())
            }
            onRequestStartOver={() => setConfirmDiscard(true)}
            onRefresh={() => void actions.handleRefresh()}
          />
        </div>
      </PageCard>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Start over from a fresh candidate?"
        description={formatDiscardDescription(view.engagedEditsCount)}
        confirmLabel={view.confirmDiscardLabel}
        variant="destructive"
        busy={actions.busy}
        onConfirm={() => void actions.handleDiscardAndRefresh()}
      />
    </>
  );
}
