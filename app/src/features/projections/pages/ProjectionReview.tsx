import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { defineRoute } from "@/routes/route-kit";
import { projectionReviewTransitions } from "./ProjectionReview.transitions";
import { toast } from "sonner";
import { approveProjectionCandidate } from "@/api/kalaidoscope/projections";
import { parseContextSpec, specToItems } from "@/api/kalaidoscope/chat";
import { useRefineSession } from "@/hooks/use-refine-session";
import { useResumeRefinement } from "@/hooks/use-resume-refinement";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";

import {
  type ContextItem,
  ContextPicker,
  Label,
  RefineChatPanel,
  RefineComposer,
} from "@/components/kalaido";
import { SnapshotComparePane } from "../components/snapshot-compare-pane";
import {
  parseProjectionOutput,
  useProjectionSnapshot,
} from "@/hooks/use-projection-snapshot";

export default function ProjectionReview() {
  const { id, snapshotId } = useParams<{ id: string; snapshotId: string }>();
  const { go } = useAppNavigate();
  const [busy, setBusy] = useState(false);

  const { projection, snapshots, liveSnapshot } = useProjectionSnapshot(id);

  // Always review the newest pending candidate. Tracking the latest pending —
  // rather than the id pinned in the URL — keeps the view correct if the set
  // changes. `snapshots` is newest-first.
  const pending = snapshots.find((s) => s.status === "pending");
  const pendingId = pending?.id;

  useEffect(() => {
    if (pendingId && pendingId !== snapshotId) {
      go(projectionReviewTransitions.viewReview, {
        params: { id, snapshotId: pendingId },
        replace: true,
      });
    }
  }, [pendingId, snapshotId, id, go]);

  // Editable context for the refine chat, seeded from the candidate's own
  // context_spec. Editing it re-emits a context_spec through the chat
  // (ChatPanel), and commit re-distills the lens with it.
  const [context, setContext] = useState<ContextItem[]>([]);
  const [pickerEpoch, setPickerEpoch] = useState(0);
  const ctxInitedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || ctxInitedFor.current === pending.id) return;
    ctxInitedFor.current = pending.id;
    const spec = parseContextSpec(pending.context_spec);
    setContext(spec ? specToItems(spec) : []);
    setPickerEpoch((e) => e + 1);
  }, [pending]);

  // The refine session is created lazily on the user's first message (see
  // startRefine), so /api/chat routes to the refinement handler only once the
  // conversation row exists — and an empty refinement can never be committed.
  // Scoped to the pending candidate so its context/window spec seeds the chat.
  const session = useRefineSession({ target: "projection" });
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
    setPickerEpoch((e) => e + 1);
  }, [resumed, openRefinement, refineContext]);

  async function startRefine() {
    const text = refineInput.trim();
    if (!text || !id || !pendingId || session.creating) return;
    await session.start({ parentId: id, prompt: text, snapshotId: pendingId });
  }

  const refinedDraft = session.preview;
  const refining = refinedDraft.length > 0;

  const live = liveSnapshot;
  const currentContent = live
    ? parseProjectionOutput(live.output).content
    : undefined;
  const pendingContent = refining
    ? refinedDraft
    : pending
      ? parseProjectionOutput(pending.output).content
      : undefined;

  const title = projection?.name || "Projection";

  // Approve either commits the refinement (when the chat produced a draft) or
  // promotes the pending candidate as-is. Discarding superseded candidates is
  // implicit — committing a refinement discards the old pending server-side.
  async function approve() {
    if (!id || !pending || busy) return;
    if (refining && session.refinementId) {
      setBusy(true);
      const ok = await session.commit(id);
      setBusy(false);
      if (ok)
        go(projectionReviewTransitions.approveSuccess, { params: { id } });
      return;
    }
    setBusy(true);
    const res = await approveProjectionCandidate(id, pending.id);
    setBusy(false);
    if (res.isErr()) {
      console.error("review: approve failed", res.error);
      toast.error("Failed to approve", { description: res.error.message });
      return;
    }
    go(projectionReviewTransitions.approveSuccess, { params: { id } });
  }

  return (
    <PageLayout>
      <PageHeader
        title="Review new snapshot"
        crumb={["Projections", title, "Review"]}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => go(projectionReviewTransitions.backToList)}
            >
              Come back later
            </Button>
            <Button
              size="sm"
              variant="commit"
              onClick={approve}
              disabled={!pending || busy}
            >
              <CheckIcon />
              {refining ? "Approve refined" : "Approve"}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {pending ? (
              <SnapshotComparePane
                currentContent={currentContent}
                pendingContent={pendingContent}
                refining={refining}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-[13px] text-fg-2">
                  Candidate not found — it may have already been approved.
                </p>
              </div>
            )}
          </div>
          <div className="flex w-[340px] shrink-0 flex-col border-l border-line">
            <div className="flex max-h-[40%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-line p-3">
              <Label>Context</Label>
              <ContextPicker
                key={pickerEpoch}
                initialValues={context}
                onChange={setContext}
                bare
              />
            </div>
            {session.started ? (
              <RefineChatPanel
                session={session}
                title="Refine with chat"
                context={context}
                placeholder="Tell Kalaido what to change…"
              />
            ) : (
              <RefineComposer
                title="Refine with chat"
                helperText="Tell Kalaido what to change about this candidate to refine it before approving."
                helperTextClassName="max-w-[80%] text-[12px] text-fg-2"
                value={refineInput}
                onChange={setRefineInput}
                placeholder="Tell Kalaido what to change…"
                disabled={!pending}
                busy={session.creating}
                onSubmit={() => void startRefine()}
              />
            )}
          </div>
        </div>
      </PageCard>
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
