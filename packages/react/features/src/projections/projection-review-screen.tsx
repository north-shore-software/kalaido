import {
  parseContextSpec,
  specToItems,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import { parseProjectionOutput } from "@kalaido/client/kalaidoscope/projections";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  type ChatPanelHandle,
  type ContextItem,
  PageHeader,
} from "@kalaido/components";
import { useFreshnessStatus } from "@kalaido/hooks/use-freshness-status";
import { ConfirmDialog } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { InfoIcon } from "@phosphor-icons/react";
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
import { useUpdateCandidateStatus } from "./hooks/use-update-candidate-status";
import { deriveReviewViewState } from "./outdated-reason";

interface ReviewWorkflowState {
  context: ContextItem[];
  refineInput: string;
}

type ReviewWorkflowEvent =
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | { readonly type: "mentionContext"; readonly item: ContextItem }
  | { readonly type: "setRefineInput"; readonly input: string };

export interface ProjectionReviewScreenProps {
  id: string;
  snapshotId: string;
  onViewReview: (
    id: string,
    snapshotId: string,
    opts?: { replace?: boolean },
  ) => void;
  renderCandidateRedirect?: (id: string, snapshotId: string) => ReactNode;
  onApproveSuccess: (id: string) => void;
  onBackToDetail: (id: string) => void;
  onBackToList: (opts?: { replace?: boolean }) => void;
}

const REVIEW_HANDLERS: ScopeHandlers<ReviewWorkflowState, ReviewWorkflowEvent> =
  {
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
  onViewReview,
  renderCandidateRedirect,
  onApproveSuccess,
  onBackToDetail,
  onBackToList,
}: ProjectionReviewScreenProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const scope = useScope({
    initial: (): ReviewWorkflowState => ({
      context: [WHOLE_SCOPE_ITEM],
      refineInput: "",
    }),
    handlers: REVIEW_HANDLERS,
  });

  const { context, refineInput } = useScopeState(scope);
  const {
    projection,
    snapshots,
    liveSnapshot,
    generatingSnapshotId,
    isLoading,
  } = useProjectionSnapshot(id);

  const pending = snapshots.find((s) => s.status === "pending_review");
  const pendingId = pending?.id;
  const isGeneratingClaim = generatingSnapshotId === snapshotId;
  const hasSnapshotRecord = snapshots.some((s) => s.id === snapshotId);
  const isNeverSaved = !liveSnapshot;

  const { isGenerating, updateError, retrying, retryUpdate } =
    useUpdateCandidateStatus({
      id,
      snapshotId,
      isLoading,
      hasPending: Boolean(pending),
      isGeneratingClaim,
      hasSnapshotRecord,
      onViewReview,
    });

  const { byId: statusById } = useFreshnessStatus();
  const candStatus = id ? statusById.get(id)?.candidate : undefined;
  const newSinceCandidate = candStatus?.newFragmentIds?.length ?? 0;

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

  const actions = useProjectionReviewActions({
    id,
    pendingId,
    session,
    onCloseConfirmDiscard: () => setConfirmDiscard(false),
    onApproveSuccess,
    onBackToDetail,
    onBackToList,
  });

  const handleLeaveDraft = isNeverSaved
    ? () => onBackToList()
    : () => onBackToDetail(id);

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

  const title = projection?.name || "Projection";
  const busy = actions.busy || isGenerating;
  const view = deriveReviewViewState({
    pendingId,
    snapshotId,
    isGeneratingClaim,
    hasRedirect: Boolean(renderCandidateRedirect),
    isNeverSaved,
    discarding: actions.discarding,
    newSinceCandidate,
    previewLength: session.preview.length,
    activeDraft: triage.activeDraft,
    busy,
    sessionPhase: session.phase,
    hasUnresolvedEdits: triage.hasUnresolvedEdits,
    title,
  });
  const currentContent = liveSnapshot
    ? parseProjectionOutput(liveSnapshot.output).content
    : undefined;

  if (view.shouldRedirectToPending && pendingId && renderCandidateRedirect) {
    return renderCandidateRedirect(id, pendingId);
  }

  return (
    <>
      <PageHeader
        title={view.headerTitle}
        crumb={view.headerCrumb}
        actions={
          <ReviewHeaderActions
            pendingEmpty={view.pendingEmpty}
            hasPending={Boolean(pending)}
            edits={triage.edits}
            proposedEditsCount={triage.proposedEditsCount}
            resolvingAll={triage.resolvingAll}
            canJumpNext={triage.canJumpNext}
            canJumpPrev={triage.canJumpPrev}
            onJumpNext={triage.jumpToNextEdit}
            onJumpPrev={triage.jumpToPrevEdit}
            onAcceptAll={() => void triage.handleResolveAll("approved")}
            onRejectAll={() => void triage.handleResolveAll("rejected")}
            approveBlocked={view.approveBlocked}
            saving={actions.saving}
            busy={busy}
            onBackToDetail={handleLeaveDraft}
            onRequestDiscard={() => setConfirmDiscard(true)}
            onApprove={() => void actions.save()}
          />
        }
      />
      <PageCard>
        {view.newSinceBanner && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-body-sm text-fg-3">
            <InfoIcon className="size-4 shrink-0 text-fg-4" />
            <span>{view.newSinceBanner}</span>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <ReviewCanvasColumn
            hasPending={Boolean(pending)}
            isGenerating={isGenerating}
            updateError={updateError}
            retrying={retrying}
            onRetryUpdate={() => void retryUpdate()}
            onBackToProjection={handleLeaveDraft}
            currentContent={currentContent}
            triage={triage}
            busy={busy}
            snapshotId={snapshotId}
          />
          <ReviewRefineColumn
            chatPanelRef={chatPanelRef}
            session={session}
            context={context as ContextItem[]}
            refineInput={refineInput}
            hasPending={Boolean(pending)}
            isGenerating={isGenerating}
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
          />
        </div>
      </PageCard>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={view.discardTitle}
        description={view.discardDescription}
        confirmLabel={view.discardConfirmLabel}
        variant="destructive"
        busy={actions.busy}
        onConfirm={() => void actions.discard()}
      />
    </>
  );
}
