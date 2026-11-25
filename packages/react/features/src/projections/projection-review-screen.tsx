import {
  parseContextSpec,
  specToItems,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import {
  approveProjectionCandidate,
  parseProjectionOutput,
  regenerateProjection,
} from "@kalaido/client/kalaidoscope/projections";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  type ChatPanelHandle,
  ContextBar,
  type ContextItem,
  PageHeader,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { useRotationStatus } from "@kalaido/hooks/use-rotation-status";
import { DecisionCard, StatusPill } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@kalaido/primitives/shadcn/alert-dialog";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { ArrowRightIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { findNextTarget } from "#rotation";
import { EditsStatusPill } from "./components/edits-status-pill";
import { ProjectionCanvasPane } from "./components/projection-canvas-pane";
import { useCandidateTriage } from "./hooks/use-candidate-triage";
import { useProjectionSnapshot } from "./hooks/use-projection-snapshot";
import { useResumeRefinement } from "./hooks/use-resume-refinement";

interface PendingFoldIn {
  readonly snapshotId: string;
  readonly mode: "single" | "wave";
}

interface ReviewWorkflowState {
  advancing: boolean;
  foldingIn: boolean;
  pendingFoldIn: PendingFoldIn | null;
  context: ContextItem[];
  refineInput: string;
}

type ReviewWorkflowEvent =
  | { readonly type: "setAdvancing"; readonly advancing: boolean }
  | { readonly type: "startFoldIn" }
  | { readonly type: "setPendingFoldIn"; readonly pending: PendingFoldIn }
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
  onApproveSuccess: (id: string) => void;
  onBackToDetail: (id: string) => void;
  onExitWave: () => void;
  onCaughtUp: () => void;
  onReviewNext: (id: string, snapshotId: string) => void;
}

/**
 * "Approve & next" moves between projections, and a fold-in ("Approve & fold
 * in" on the outdated-candidate card) moves between candidates of the same
 * projection, without leaving
 * this route — so React would otherwise keep the page mounted and carry its
 * state across. That state is per-candidate: an open refine session, its chat
 * history, and the drafted preview that decides whether Approve commits a
 * refinement. Carried over, it would offer one candidate's draft as another's,
 * and a second Approve would re-commit an already-committed refinement. Key
 * the page on the candidate to force a clean mount.
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
  onApproveSuccess,
  onBackToDetail,
  onExitWave,
  onCaughtUp,
  onReviewNext,
}: ProjectionReviewScreenProps) {
  const client = useKalaidoscopeClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const scope = useScope<ReviewWorkflowState, ReviewWorkflowEvent>({
    initial: () => ({
      advancing: false,
      foldingIn: false,
      pendingFoldIn: null,
      context: [WHOLE_SCOPE_ITEM],
      refineInput: "",
    }),
    handlers: {
      setAdvancing: (s, e) => {
        s.advancing = e.advancing;
      },
      startFoldIn: (s) => {
        s.foldingIn = true;
      },
      setPendingFoldIn: (s, e) => {
        s.pendingFoldIn = e.pending;
      },
      clearFoldIn: (s) => {
        s.foldingIn = false;
        s.pendingFoldIn = null;
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
    },
  });

  const { advancing, foldingIn, pendingFoldIn, context, refineInput } =
    useScopeState(scope);

  const { projection, snapshots, liveSnapshot } = useProjectionSnapshot(id);

  // Always review the newest pending candidate. Tracking the latest pending —
  // rather than the id pinned in the URL — keeps the view correct if the set
  // changes. `snapshots` is newest-first.
  const pending = snapshots.find((s) => s.status === "pending_review");
  const pendingId = pending?.id;

  const { byId: statusById } = useRotationStatus();
  const candStatus = id ? statusById.get(id)?.candidate : undefined;
  const isCandidateOutdated = Boolean(
    pendingId && candStatus?.id === pendingId && candStatus.outdated,
  );
  const isCandidateEngaged = Boolean(
    pendingId && candStatus?.id === pendingId && candStatus.engaged,
  );

  // The server decides why the candidate is outdated (it resolves the scope
  // and knows the effective model); the client only words it.
  const newCount = candStatus?.newFragmentIds?.length ?? 0;
  let outdatedReason: string;
  switch (candStatus?.reason) {
    case "new_fragments":
      outdatedReason = `${newCount} new fragment${newCount === 1 ? "" : "s"}`;
      break;
    case "lens_changed":
      outdatedReason = "lens changed";
      break;
    case "model_changed":
      outdatedReason = "model changed";
      break;
    default:
      outdatedReason = "context changed";
  }

  useEffect(() => {
    if (pendingId && pendingId !== snapshotId) {
      onViewReview(id, pendingId, { wave: inWave, replace: true });
    }
  }, [pendingId, snapshotId, id, onViewReview, inWave]);

  // Editable context for the refine chat, seeded from the candidate's own
  // context_spec. Editing it re-emits a context_spec through the chat
  // (ChatPanel), and commit re-distills the lens with it.
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

  // The refine session is created lazily on the user's first message (see
  // startRefine), so /api/chat routes to the refinement handler only once the
  // conversation row exists — and an empty refinement can never be committed.
  // Scoped to the pending candidate so its context/window spec seeds the chat.
  const session = useRefineSession({ target: "projection" });
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  const approveWrite = useExternalWrite<
    { projectionId: string; snapshotId: string },
    void
  >({
    execute: ({ projectionId, snapshotId: targetSnapshotId }) =>
      approveProjectionCandidate(projectionId, targetSnapshotId),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const regenerateWrite = useExternalWrite<
    {
      projectionId: string;
      opts?: { discardEngaged?: boolean; foldIn?: boolean };
    },
    { readonly id: string }
  >({
    execute: ({ projectionId, opts }) =>
      regenerateProjection(projectionId, false, opts),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "projection_snapshot"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
  });

  const busy =
    approveWrite.isPending || regenerateWrite.isPending || session.committing;

  // If a refinement was already started over this candidate (e.g. the user hit
  // "Come back later" mid-refine), resume it so the chat history and drafted
  // preview reappear instead of the untouched candidate.
  const {
    openRefinement,
    context: refineContext,
    resumed,
  } = useResumeRefinement({
    session,
    parentId: id,
    snapshotId: pendingId ?? "",
    enabled: !!pendingId,
  });

  // Once resumed, the refinement's own context supersedes the candidate seed
  // above — the user may have edited context mid-refine. An empty refineContext
  // means the refinement never re-pinned context, so the candidate seed already
  // reflects the right selection.
  const ctxResumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!resumed || !openRefinement || refineContext.length === 0) return;
    if (ctxResumedFor.current === openRefinement.id) return;
    ctxResumedFor.current = openRefinement.id;
    void scope.dispatch({ type: "setContext", context: refineContext });
  }, [resumed, openRefinement, refineContext, scope]);

  async function startRefine() {
    const text = refineInput.trim();
    if (!text || !id || !pendingId || session.creating) return;
    await session.start({ parentId: id, prompt: text, snapshotId: pendingId });
  }

  const triage = useCandidateTriage({
    projectionId: id,
    pending,
    session,
    chatPanelRef,
  });
  const {
    edits,
    proposedEditsCount,
    hasUnresolvedEdits,
    activeDraft,
    highlightedEditId,
  } = triage;
  const engagedEditsCount = edits.filter(
    (e) => e.type === "manual" || e.type === "refinement",
  ).length;
  const showRefined = session.preview.length > 0;

  const live = liveSnapshot;
  const currentContent = live
    ? parseProjectionOutput(live.output).content
    : undefined;
  const pendingContent = activeDraft;

  const title = projection?.name || "Projection";

  // A candidate with no content must never become the plan of record (the
  // server refuses it too — this just keeps the buttons honest). Old rows from
  // before the server-side guard may still be empty.
  const pendingEmpty =
    !!pending && !showRefined && !(pendingContent ?? "").trim();

  // The same guard every approve path shares: something to approve, nothing
  // in flight, and no proposed edit left undecided.
  const approveBlocked =
    !pending ||
    pendingEmpty ||
    busy ||
    advancing ||
    session.phase === "drafting" ||
    session.phase === "applying" ||
    hasUnresolvedEdits;

  // An outdated candidate is a question the page asks in the chat column, and
  // it gates everything else until answered. There is no "later": the ways
  // out without deciding are the ones that leave the page (Come back later,
  // Skip, Exit wave). Deciding proposals already on the candidate stays open
  // while it is up, because folding in needs every one of them decided.
  const gateOpen = isCandidateOutdated && !!pending;

  const advanceToNextInWave = useCallback(async () => {
    const next = await findNextTarget({ projectionsOnly: true });
    void scope.dispatch({ type: "setAdvancing", advancing: false });

    if (next.isErr()) {
      // The approval itself succeeded, so land somewhere sane and say why.
      toast.error("Couldn't work out what's next", {
        description: next.error.message,
      });
      onApproveSuccess(id);
      return;
    }
    if (!next.value) {
      onCaughtUp();
      return;
    }
    // A projection can be its own next step: its candidate was generated
    // against context that has since moved on, so approving it did not settle
    // it. Say so, rather than looking like the button did nothing.
    if (next.value.id === id) {
      toast.info("Approved — but it needs another pass", {
        description:
          "New context landed after this candidate was generated, so a fresh one is ready to review.",
      });
    }
    // Projection stops always carry the candidate to review.
    if (!next.value.snapshotId) return;
    onReviewNext(next.value.id, next.value.snapshotId);
  }, [id, scope, onApproveSuccess, onCaughtUp, onReviewNext]);

  // Pure CQRS fold-in settlement: once `regenerateWrite` resolves (after
  // awaiting invalidation of `projection_snapshot` and `reconcile`), branch on
  // the live snapshot's status.
  useEffect(() => {
    if (!pendingFoldIn) return;
    const target = snapshots.find((s) => s.id === pendingFoldIn.snapshotId);
    if (!target) return;
    const { snapshotId: targetId, mode } = pendingFoldIn;
    void scope.dispatch({ type: "clearFoldIn" });

    if (target.status === "pending_review") {
      if (mode === "wave") {
        toast.info("Approved — fresh candidate ready to review", {
          description:
            "New context landed after this candidate was generated, so a fresh one is ready to review.",
        });
        void scope.dispatch({ type: "setAdvancing", advancing: false });
        onViewReview(id, targetId, { wave: true, replace: true });
      } else {
        toast.info("Candidate updated with new context");
        onViewReview(id, targetId, { wave: inWave, replace: true });
      }
      return;
    }

    if (mode === "single") {
      toast.success("Approved and up to date");
      onApproveSuccess(id);
    } else {
      void advanceToNextInWave();
    }
  }, [
    pendingFoldIn,
    snapshots,
    id,
    inWave,
    scope,
    onViewReview,
    onApproveSuccess,
    advanceToNextInWave,
  ]);

  // Approve either commits the refinement (when the chat produced a draft) or
  // promotes the pending candidate as-is. Approval discards superseded pending
  // candidates server-side, for commits and as-is approvals alike.
  // Returns whether the approval landed, so callers can decide where to go.
  async function runApprove(): Promise<boolean> {
    if (!id || !pending || busy) return false;
    if (session.started && session.hasDraftedLens) {
      return session.commit(id);
    }
    const outcome = await approveWrite.run({
      projectionId: id,
      snapshotId: pending.id,
    });
    if (outcome.status === "ignored") return false;
    if (outcome.status === "error") {
      console.error("review: approve failed", outcome.error);
      toast.error("Failed to approve", { description: outcome.error.message });
      return false;
    }
    return true;
  }

  async function approve() {
    if (!id) return;
    if (await runApprove()) {
      onApproveSuccess(id);
    }
  }

  /** Move to another candidate of this projection, staying in the wave if in one. */
  function goToCandidate(nextSnapshotId: string) {
    if (!id) return;
    onViewReview(id, nextSnapshotId, { wave: inWave, replace: true });
  }

  async function handleRefresh() {
    if (!id || busy || advancing) return;
    const outcome = await regenerateWrite.run({ projectionId: id });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't refresh", { description: outcome.error.message });
      return;
    }
    goToCandidate(outcome.id);
  }

  async function handleDiscardAndRefresh() {
    if (!id || busy || advancing) return;
    const outcome = await regenerateWrite.run({
      projectionId: id,
      opts: { discardEngaged: true },
    });
    setConfirmDiscard(false);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Couldn't refresh", { description: outcome.error.message });
      return;
    }
    goToCandidate(outcome.id);
  }

  async function handleApproveAndRefresh() {
    if (!id || busy || advancing) return;
    const ok = await runApprove();
    if (!ok) return;
    await scope.dispatch({ type: "startFoldIn" });
    const outcome = await regenerateWrite.run({
      projectionId: id,
      opts: { foldIn: true },
    });
    if (outcome.status === "ignored") {
      void scope.dispatch({ type: "clearFoldIn" });
      return;
    }
    if (outcome.status === "error") {
      void scope.dispatch({ type: "clearFoldIn" });
      toast.error("Approved, but couldn't refresh", {
        description: outcome.error.message,
      });
      onApproveSuccess(id);
      return;
    }
    await scope.dispatch({
      type: "setPendingFoldIn",
      pending: { snapshotId: outcome.id, mode: "single" },
    });
  }

  /**
   * Skip this projection in the wave and work out what to go to next.
   */
  async function skipCurrent() {
    if (!id || advancing) return;
    await scope.dispatch({ type: "setAdvancing", advancing: true });
    const next = await findNextTarget({ skip: [id], projectionsOnly: true });
    await scope.dispatch({ type: "setAdvancing", advancing: false });

    if (next.isErr()) {
      toast.error("Couldn't work out what's next", {
        description: next.error.message,
      });
      return;
    }
    if (!next.value?.snapshotId) {
      toast.info("Nothing else to review in wave");
      onExitWave();
      return;
    }
    onReviewNext(next.value.id, next.value.snapshotId);
  }

  /**
   * Approve, then go wherever the plan says to go next. The plan is re-read
   * after the approval precisely because approving changes it: this projection
   * drops out, and anything that was waiting on it becomes available.
   */
  async function approveAndNext() {
    if (!id || advancing) return;

    // Held across both steps so the buttons never re-enable in between.
    await scope.dispatch({ type: "setAdvancing", advancing: true });
    if (!(await runApprove())) {
      await scope.dispatch({ type: "setAdvancing", advancing: false });
      return;
    }
    if (isCandidateOutdated) {
      await scope.dispatch({ type: "startFoldIn" });
      const outcome = await regenerateWrite.run({
        projectionId: id,
        opts: { foldIn: true },
      });
      if (outcome.status === "ignored") {
        await scope.dispatch({ type: "clearFoldIn" });
        await scope.dispatch({ type: "setAdvancing", advancing: false });
        return;
      }
      if (outcome.status === "error") {
        await scope.dispatch({ type: "clearFoldIn" });
        await scope.dispatch({ type: "setAdvancing", advancing: false });
        toast.error("Approved, but couldn't refresh", {
          description: outcome.error.message,
        });
        onApproveSuccess(id);
        return;
      }
      await scope.dispatch({
        type: "setPendingFoldIn",
        pending: { snapshotId: outcome.id, mode: "wave" },
      });
      return;
    }
    await advanceToNextInWave();
  }

  const generatedAt = pending
    ? formatShortDateTime(pending.generated_at || pending.created)
    : "";
  const outdatedSince =
    candStatus?.reason === "new_fragments"
      ? `${outdatedReason} arrived after this candidate was generated (${generatedAt}).`
      : `The ${outdatedReason} after this candidate was generated (${generatedAt}).`;
  const gateCard = gateOpen ? (
    <DecisionCard
      icon={<WarningIcon className="size-4 shrink-0 text-drifting-ink" />}
      title="Candidate is out of date"
      busy={busy || advancing}
      description={
        isCandidateEngaged
          ? `${outdatedSince} Your edits and refinements live on this candidate, so choose how to bring it up to date.${
              hasUnresolvedEdits
                ? ` Accept or reject the ${proposedEditsCount === 1 ? "proposed edit" : `${proposedEditsCount} proposed edits`} on the left first, then fold in.`
                : ""
            }`
          : `${outdatedSince} Nothing has been edited on it, so it can simply be regenerated.`
      }
      options={
        isCandidateEngaged
          ? [
              {
                id: "fold-in",
                label: "Approve & fold in",
                variant: "commit",
                disabled: approveBlocked,
                onSelect: () =>
                  void (inWave ? approveAndNext() : handleApproveAndRefresh()),
              },
              {
                id: "start-over",
                label: "Start over",
                variant: "destructive",
                onSelect: () => setConfirmDiscard(true),
              },
            ]
          : [
              {
                id: "refresh",
                label: "Refresh",
                variant: "commit",
                onSelect: () => void handleRefresh(),
              },
            ]
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        title={inWave ? "Review snapshot" : "Review update"}
        crumb={
          inWave
            ? ["Wave", title, "Review"]
            : ["Projections", title, "Review update"]
        }
        actions={
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
              onNext={triage.jumpToNextEdit}
              onPrev={triage.jumpToPrevEdit}
              canNext={triage.canJumpNext}
              canPrev={triage.canJumpPrev}
            />
            {inWave ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || advancing || gateOpen}
                  onClick={() => void skipCurrent()}
                >
                  Skip
                </Button>
                <Button variant="outline" size="sm" onClick={onExitWave}>
                  Exit wave
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void approve()}
                  disabled={approveBlocked || gateOpen}
                >
                  <CheckIcon />
                  Approve & exit
                </Button>
                <Button
                  variant="commit"
                  size="sm"
                  onClick={() => void approveAndNext()}
                  disabled={approveBlocked || gateOpen}
                >
                  {advancing ? "Finding next…" : "Approve & next"}
                  <ArrowRightIcon />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBackToDetail(id)}
                >
                  Come back later
                </Button>
                <Button
                  variant="commit"
                  size="sm"
                  onClick={() => void approve()}
                  disabled={approveBlocked || gateOpen}
                >
                  <CheckIcon />
                  {session.hasDraftedLens ? "Approve refined" : "Approve"}
                </Button>
              </>
            )}
          </>
        }
      />
      <PageCard>
        {isCandidateOutdated && pending && (
          <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5 text-body-sm">
            <div className="flex items-center gap-2 text-fg-2">
              <WarningIcon className="size-4 shrink-0 text-drifting-ink" />
              <span>
                Candidate is out of date ({outdatedReason}) · Generated{" "}
                {generatedAt}
              </span>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
            {pending ? (
              <ProjectionCanvasPane
                content={currentContent}
                triage={triage}
                busy={busy || advancing}
                frozen={gateOpen}
                resetKey={snapshotId}
              />
            ) : foldingIn || advancing ? (
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
          <div className="flex min-w-0 flex-[1.05] flex-col bg-surface-1">
            {session.started ? (
              <RefineChatPanel
                ref={chatPanelRef}
                session={session}
                title="Refine with chat"
                context={context as ContextItem[]}
                onMention={(item) =>
                  void scope.dispatch({ type: "mentionContext", item })
                }
                onContextChange={(next) =>
                  void scope.dispatch({ type: "setContext", context: next })
                }
                entity="projection"
                highlightedEditId={highlightedEditId}
                edits={edits}
                onUndoEdit={triage.handleUndoEdit}
                placeholder="Tell Kalaido what to change…"
                input={refineInput}
                onInputChange={(next) =>
                  void scope.dispatch({ type: "setRefineInput", input: next })
                }
                disabled={gateOpen || foldingIn}
                trailing={gateCard}
              />
            ) : (
              <RefineComposer
                title="Refine with chat"
                helperText="Tell Kalaido what to change about this candidate to refine it before approving."
                helperTextClassName="max-w-[80%]"
                value={refineInput}
                onChange={(next) =>
                  void scope.dispatch({ type: "setRefineInput", input: next })
                }
                placeholder="Tell Kalaido what to change…"
                disabled={!pending || gateOpen || foldingIn}
                busy={session.creating}
                onSubmit={() => void startRefine()}
                onMention={(item) =>
                  void scope.dispatch({ type: "mentionContext", item })
                }
                beforeInput={
                  <div inert={gateOpen || foldingIn}>
                    <ContextBar
                      items={context as ContextItem[]}
                      onChange={(next) =>
                        void scope.dispatch({
                          type: "setContext",
                          context: next,
                        })
                      }
                      entity="projection"
                    />
                  </div>
                }
              >
                {gateCard}
              </RefineComposer>
            )}
          </div>
        </div>
      </PageCard>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Start over from a fresh candidate?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {engagedEditsCount > 0
                ? `This candidate has ${engagedEditsCount} edit${engagedEditsCount > 1 ? "s" : ""} that will be permanently lost if you discard it. A fresh candidate will be generated.`
                : "This candidate has refinements that will be permanently lost if you discard it. A fresh candidate will be generated."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDiscardAndRefresh()}
              disabled={busy}
            >
              {busy ? "Refreshing…" : "Start over"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
