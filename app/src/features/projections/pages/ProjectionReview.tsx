import { ArrowRightIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { parseContextSpec, specToItems } from "@/api/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  approveProjectionCandidate,
  regenerateProjection,
} from "@/api/kalaidoscope/projections";
import { withActiveClient } from "@/api/kalaidoscope/_active";
import { EditsStatusPill } from "../components/edits-status-pill";
import { useCandidateTriage } from "../hooks/use-candidate-triage";
import {
  type ChatPanelHandle,
  ContextBar,
  type ContextItem,
  DecisionCard,
  RefineChatPanel,
  RefineComposer,
  StatusPill,
} from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProjectionCanvasPane } from "../components/projection-canvas-pane";
import { findNextTarget } from "@/features/rotation/next-target";
import {
  type ProjectionSnapshotWithEdits,
  parseProjectionOutput,
  useProjectionSnapshot,
} from "@/hooks/use-projection-snapshot";
import { useRefineSession } from "@/hooks/use-refine-session";
import { useResumeRefinement } from "@/hooks/use-resume-refinement";
import { useRotationStatus } from "@/hooks/use-rotation-status";
import { formatShortDateTime } from "@/lib/datetime";
import { withContextItem } from "@/lib/mentions";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { useAppParams } from "@/routes/use-app-params";
import { useAppRouteState } from "@/routes/use-app-route-state";
import { projectionReviewTransitions } from "./ProjectionReview.transitions";

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
export default function ProjectionReview() {
  const { id, snapshotId } = useAppParams<"projection-review">();
  return <ProjectionReviewPage key={`${id}:${snapshotId}`} />;
}

function ProjectionReviewPage() {
  const { id, snapshotId } = useAppParams<"projection-review">();
  const routeState = useAppRouteState<"projection-review">();
  const inWave = Boolean(routeState?.wave);
  const { go } = useAppNavigate();
  const [busy, setBusy] = useState(false);
  // An "approve & next" is in flight: approving, then working out and preparing
  // whatever comes after it.
  const [advancing, setAdvancing] = useState(false);

  const { projection, snapshots, liveSnapshot, mutate } =
    useProjectionSnapshot(id);

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

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A fold-in has approved the candidate and is generating its successor.
  // The approved row is no longer pending, so without this the canvas would
  // read "candidate not found" for the whole generation.
  const [foldingIn, setFoldingIn] = useState(false);

  useEffect(() => {
    if (pendingId && pendingId !== snapshotId) {
      go(projectionReviewTransitions.viewReview, {
        params: { id, snapshotId: pendingId },
        state: inWave ? { wave: true } : undefined,
        replace: true,
      });
    }
  }, [pendingId, snapshotId, id, go, inWave]);

  // Editable context for the refine chat, seeded from the candidate's own
  // context_spec. Editing it re-emits a context_spec through the chat
  // (ChatPanel), and commit re-distills the lens with it.
  const [context, setContext] = useState<ContextItem[]>([WHOLE_SCOPE_ITEM]);
  const ctxInitedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || ctxInitedFor.current === pending.id) return;
    ctxInitedFor.current = pending.id;
    const spec = parseContextSpec(pending.context_spec);
    setContext(spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM]);
  }, [pending]);

  // The refine session is created lazily on the user's first message (see
  // startRefine), so /api/chat routes to the refinement handler only once the
  // conversation row exists — and an empty refinement can never be committed.
  // Scoped to the pending candidate so its context/window spec seeds the chat.
  const session = useRefineSession({ target: "projection" });
  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const [refineInput, setRefineInput] = useState("");

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
    setContext(refineContext);
  }, [resumed, openRefinement, refineContext]);

  async function startRefine() {
    const text = refineInput.trim();
    if (!text || !id || !pendingId || session.creating) return;
    await session.start({ parentId: id, prompt: text, snapshotId: pendingId });
  }

  const triage = useCandidateTriage({
    projectionId: id,
    pending,
    mutate,
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

  // Approve either commits the refinement (when the chat produced a draft) or
  // promotes the pending candidate as-is. Approval discards superseded pending
  // candidates server-side, for commits and as-is approvals alike.
  // Returns whether the approval landed, so callers can decide where to go.
  async function runApprove(): Promise<boolean> {
    if (!id || !pending || busy) return false;
    if (session.started && session.hasDraftedLens) {
      setBusy(true);
      const ok = await session.commit(id);
      setBusy(false);
      return ok;
    }
    setBusy(true);
    const res = await approveProjectionCandidate(id, pending.id);
    setBusy(false);
    if (res.isErr()) {
      console.error("review: approve failed", res.error);
      toast.error("Failed to approve", { description: res.error.message });
      return false;
    }
    return true;
  }

  async function approve() {
    if (!id) return;
    if (await runApprove()) {
      go(projectionReviewTransitions.approveSuccess, { params: { id } });
    }
  }

  /** Move to another candidate of this projection, staying in the wave if in one. */
  function goToCandidate(nextSnapshotId: string) {
    if (!id) return;
    go(projectionReviewTransitions.viewReview, {
      params: { id, snapshotId: nextSnapshotId },
      replace: true,
      ...(inWave ? { state: { wave: true } } : {}),
    });
  }

  async function handleRefresh() {
    if (!id || busy || advancing) return;
    setBusy(true);
    const res = await regenerateProjection(id, false);
    setBusy(false);
    if (res.isErr()) {
      toast.error("Couldn't refresh", { description: res.error.message });
      return;
    }
    await mutate();
    goToCandidate(res.value.snapshotId);
  }

  async function handleDiscardAndRefresh() {
    if (!id || busy || advancing) return;
    setBusy(true);
    const res = await regenerateProjection(id, false, { discardEngaged: true });
    setBusy(false);
    setConfirmDiscard(false);
    if (res.isErr()) {
      toast.error("Couldn't refresh", { description: res.error.message });
      return;
    }
    await mutate();
    goToCandidate(res.value.snapshotId);
  }

  async function handleApproveAndRefresh() {
    if (!id || busy || advancing) return;
    const ok = await runApprove();
    if (!ok) return;
    setBusy(true);
    setFoldingIn(true);
    const res = await regenerateProjection(id, false, { foldIn: true });
    setBusy(false);
    if (res.isErr()) {
      setFoldingIn(false);
      toast.error("Approved, but couldn't refresh", {
        description: res.error.message,
      });
      go(projectionReviewTransitions.approveSuccess, { params: { id } });
      return;
    }
    const resSnaps = (await mutate()) as
      | ProjectionSnapshotWithEdits[]
      | undefined;
    const target = resSnaps?.find((s) => s.id === res.value.snapshotId);
    let isPending = target?.status === "pending_review";
    if (!target) {
      const snapRes = await withActiveClient((c) =>
        c.collection("projection_snapshot").getOne(res.value.snapshotId),
      );
      if (snapRes.isOk()) {
        isPending = snapRes.value.status === "pending_review";
      }
    }
    setFoldingIn(false);
    if (isPending) {
      toast.info("Candidate updated with new context");
      goToCandidate(res.value.snapshotId);
    } else {
      toast.success("Approved and up to date");
      go(projectionReviewTransitions.approveSuccess, { params: { id } });
    }
  }

  /**
   * Skip this projection in the wave and work out what to go to next.
   */
  async function skipCurrent() {
    if (!id || advancing) return;
    setAdvancing(true);
    const next = await findNextTarget({ skip: [id], projectionsOnly: true });
    setAdvancing(false);

    if (next.isErr()) {
      toast.error("Couldn't work out what's next", {
        description: next.error.message,
      });
      return;
    }
    if (!next.value?.snapshotId) {
      toast.info("Nothing else to review in wave");
      go(projectionReviewTransitions.exitWave);
      return;
    }
    go(projectionReviewTransitions.reviewNext, {
      params: { id: next.value.id, snapshotId: next.value.snapshotId },
      state: { wave: true },
    });
  }

  /**
   * Approve, then go wherever the plan says to go next. The plan is re-read
   * after the approval precisely because approving changes it: this projection
   * drops out, and anything that was waiting on it becomes available.
   */
  async function approveAndNext() {
    if (!id || advancing) return;

    // Held across both steps so the buttons never re-enable in between.
    setAdvancing(true);
    if (!(await runApprove())) {
      setAdvancing(false);
      return;
    }
    if (isCandidateOutdated) {
      setFoldingIn(true);
      const res = await regenerateProjection(id, false, { foldIn: true });
      setFoldingIn(false);
      if (res.isErr()) {
        toast.error("Approved, but couldn't refresh", {
          description: res.error.message,
        });
        setAdvancing(false);
        go(projectionReviewTransitions.approveSuccess, { params: { id } });
        return;
      }
      const resSnaps = (await mutate()) as
        | ProjectionSnapshotWithEdits[]
        | undefined;
      const target = resSnaps?.find((s) => s.id === res.value.snapshotId);
      let isPending = target?.status === "pending_review";
      if (!target) {
        const snapRes = await withActiveClient((c) =>
          c.collection("projection_snapshot").getOne(res.value.snapshotId),
        );
        if (snapRes.isOk()) {
          isPending = snapRes.value.status === "pending_review";
        }
      }
      if (isPending) {
        toast.info("Approved — fresh candidate ready to review", {
          description:
            "New context landed after this candidate was generated, so a fresh one is ready to review.",
        });
        setAdvancing(false);
        go(projectionReviewTransitions.viewReview, {
          params: { id, snapshotId: res.value.snapshotId },
          state: { wave: true },
          replace: true,
        });
        return;
      }
    }
    const next = await findNextTarget({ projectionsOnly: true });
    setAdvancing(false);

    if (next.isErr()) {
      // The approval itself succeeded, so land somewhere sane and say why.
      toast.error("Couldn't work out what's next", {
        description: next.error.message,
      });
      go(projectionReviewTransitions.approveSuccess, { params: { id } });
      return;
    }
    if (!next.value) {
      go(projectionReviewTransitions.caughtUp);
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
    go(projectionReviewTransitions.reviewNext, {
      params: { id: next.value.id, snapshotId: next.value.snapshotId },
      state: { wave: true },
    });
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
    <PageLayout>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => go(projectionReviewTransitions.exitWave)}
                >
                  Exit wave
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={approve}
                  disabled={approveBlocked || gateOpen}
                >
                  <CheckIcon />
                  Approve & exit
                </Button>
                <Button
                  variant="commit"
                  size="sm"
                  onClick={approveAndNext}
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
                  onClick={() =>
                    go(projectionReviewTransitions.backToDetail, {
                      params: { id },
                    })
                  }
                >
                  Come back later
                </Button>
                <Button
                  variant="commit"
                  size="sm"
                  onClick={approve}
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
                context={context}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                onContextChange={setContext}
                entity="projection"
                highlightedEditId={highlightedEditId}
                edits={edits}
                onUndoEdit={triage.handleUndoEdit}
                placeholder="Tell Kalaido what to change…"
                input={refineInput}
                onInputChange={setRefineInput}
                disabled={gateOpen || foldingIn}
                trailing={gateCard}
              />
            ) : (
              <RefineComposer
                title="Refine with chat"
                helperText="Tell Kalaido what to change about this candidate to refine it before approving."
                helperTextClassName="max-w-[80%]"
                value={refineInput}
                onChange={setRefineInput}
                placeholder="Tell Kalaido what to change…"
                disabled={!pending || gateOpen || foldingIn}
                busy={session.creating}
                onSubmit={() => void startRefine()}
                onMention={(item) =>
                  setContext((prev) => withContextItem(prev, item))
                }
                beforeInput={
                  <div inert={gateOpen || foldingIn}>
                    <ContextBar
                      items={context}
                      onChange={setContext}
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
    </PageLayout>
  );
}

export const projectionReviewRoute = defineRoute({
  id: "projection-review",
  path: "/projections/:id/review/:snapshotId",
  feature: "Projections",
  requiredScope: ["kalaidoscope"],
  transitions: projectionReviewTransitions,
  Component: ProjectionReview,
});
