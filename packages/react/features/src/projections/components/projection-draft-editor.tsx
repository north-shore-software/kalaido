import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import type { RefinePhase } from "@kalaido/client/kalaidoscope/refinements";
import { withContextItem } from "@kalaido/client/lib/mentions";
import {
  type ChatPanelHandle,
  type ContextItem,
  PageHeader,
  RefineChatPanel,
} from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { Pill } from "@kalaido/primitives/kalaido";
import {
  PageCard,
  PaneHeader,
} from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import {
  useCandidateTriage,
  type UseCandidateTriageResult,
} from "../hooks/use-candidate-triage";
import { useProjectionSnapshot } from "../hooks/use-projection-snapshot";
import { EditsStatusPill } from "./edits-status-pill";
import { ProjectionCanvasPane } from "./projection-canvas-pane";

export interface ProjectionDraftEditorProps {
  session: RefineSession;
  projectionId: string;
  title: string;
  crumb: string[];
  initialContext?: ContextItem[];
  approveLabel?: string;
  onTitleCommit?: (next: string) => void;
  onCancel: () => void;
  onApproveSuccess: (id: string) => void;
}

function draftPhaseStatus(phase: RefinePhase, hasDraftText: boolean): string {
  if (phase === "drafting") return "drafting";
  if (phase === "applying") return "generating";
  return hasDraftText ? "draft" : "pending";
}

function draftEmptyCopy(phase: RefinePhase): string {
  if (phase === "drafting") return "Drafting the instruction…";
  if (phase === "applying") return "Generating the preview…";
  return "Nothing drafted yet.";
}

function approveButtonLabel(
  committing: boolean,
  approveLabel: string | undefined,
): string {
  if (!committing) return approveLabel ?? "Save";
  return approveLabel === "Create projection" ? "Creating…" : "Saving…";
}

function DraftPreviewColumn({
  phase,
  hasDraftText,
  triage,
  canHandEdit,
}: {
  phase: RefinePhase;
  hasDraftText: boolean;
  triage: UseCandidateTriageResult;
  canHandEdit: boolean;
}) {
  const busy = phase === "drafting" || phase === "applying";
  return (
    <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
      <PaneHeader
        label="Live draft preview"
        status={
          <Pill tone="primary" dot>
            {draftPhaseStatus(phase, hasDraftText)}
          </Pill>
        }
      />
      {hasDraftText ? (
        <ProjectionCanvasPane
          triage={triage}
          busy={busy}
          canHandEdit={canHandEdit}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-body-sm text-fg-2">{draftEmptyCopy(phase)}</p>
        </div>
      )}
    </div>
  );
}

export function ProjectionDraftEditor({
  session,
  projectionId,
  title,
  crumb,
  initialContext,
  approveLabel,
  onTitleCommit,
  onCancel,
  onApproveSuccess,
}: ProjectionDraftEditorProps) {
  const [context, setContext] = useState<ContextItem[]>(
    initialContext ?? [WHOLE_SCOPE_ITEM],
  );
  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const [chatInput, setChatInput] = useState("");

  const { snapshots } = useProjectionSnapshot(projectionId);
  const pending = snapshots.find((s) => s.status === "pending_review");

  const triage = useCandidateTriage({
    projectionId,
    pending,
    session,
    chatPanelRef,
  });

  const hasDraftText = Boolean(triage.activeDraft?.length);
  const busy = session.phase === "drafting" || session.phase === "applying";
  const canApprove =
    (hasDraftText || session.previewReady) &&
    !triage.hasUnresolvedEdits &&
    !session.committing &&
    !busy;

  async function approve() {
    if (!canApprove) return;
    if (await session.commit(projectionId)) {
      onApproveSuccess(projectionId);
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        crumb={crumb}
        onTitleCommit={onTitleCommit}
        actions={
          <>
            <EditsStatusPill
              edits={triage.edits}
              onNext={triage.jumpToNextEdit}
              onPrev={triage.jumpToPrevEdit}
              canNext={triage.canJumpNext}
              canPrev={triage.canJumpPrev}
            />
            {triage.proposedEditsCount > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || triage.resolvingAll}
                  onClick={() => void triage.handleResolveAll("approved")}
                >
                  <CheckIcon />
                  Accept all
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || triage.resolvingAll}
                  onClick={() => void triage.handleResolveAll("rejected")}
                >
                  <XIcon />
                  Reject all
                </Button>
              </div>
            )}
            <Button variant="ghost" onClick={onCancel}>
              Discard
            </Button>
            <Button
              variant="commit"
              disabled={!canApprove}
              onClick={() => void approve()}
            >
              <CheckIcon />
              {approveButtonLabel(session.committing, approveLabel)}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <DraftPreviewColumn
            phase={session.phase}
            hasDraftText={hasDraftText}
            triage={triage}
            canHandEdit={Boolean(pending?.id)}
          />
          <div className="flex min-w-0 flex-[1.05] flex-col">
            <RefineChatPanel
              ref={chatPanelRef}
              session={session}
              title="Define via chat"
              context={context}
              onMention={(item) =>
                setContext((prev) => withContextItem(prev, item))
              }
              onContextChange={setContext}
              notifyOnContextChange
              entity="projection"
              highlightedEditId={triage.highlightedEditId}
              edits={triage.edits}
              onUndoEdit={triage.handleUndoEdit}
              input={chatInput}
              onInputChange={setChatInput}
            />
          </div>
        </div>
      </PageCard>
    </>
  );
}
