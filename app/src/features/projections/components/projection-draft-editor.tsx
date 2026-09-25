import { CheckIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  type ChatPanelHandle,
  type ContextItem,
  Pill,
  RefineChatPanel,
} from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
  PaneHeader,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { useProjectionSnapshot } from "@/hooks/use-projection-snapshot";
import type { RefineSession } from "@/hooks/use-refine-session";
import { withContextItem } from "@/lib/mentions";
import { EditsStatusPill } from "./edits-status-pill";
import { ProjectionCanvasPane } from "./projection-canvas-pane";
import { useCandidateTriage } from "../hooks/use-candidate-triage";

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

  const { snapshots, mutate } = useProjectionSnapshot(projectionId);
  const pending = snapshots.find((s) => s.status === "pending_review");
  const pendingId = pending?.id;

  const triage = useCandidateTriage({
    projectionId,
    pending,
    mutate,
    session,
    chatPanelRef,
  });
  const { edits, hasUnresolvedEdits, activeDraft, highlightedEditId } = triage;

  const hasDraft =
    (activeDraft && activeDraft.length > 0) || session.previewReady;
  const canApprove = hasDraft && !hasUnresolvedEdits && !session.committing;

  async function approve() {
    if (!canApprove) return;
    if (await session.commit(projectionId)) {
      onApproveSuccess(projectionId);
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title={title}
        crumb={crumb}
        onTitleCommit={onTitleCommit}
        actions={
          <>
            <EditsStatusPill
              edits={edits}
              onNext={triage.jumpToNextEdit}
              onPrev={triage.jumpToPrevEdit}
              canNext={triage.canJumpNext}
              canPrev={triage.canJumpPrev}
            />
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="commit"
              disabled={!canApprove}
              onClick={() => void approve()}
            >
              <CheckIcon />
              {session.committing
                ? approveLabel === "Create projection"
                  ? "Creating…"
                  : "Approving…"
                : (approveLabel ?? "Approve")}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
            <PaneHeader
              label="Live draft preview"
              status={
                <Pill tone="primary" dot>
                  {session.phase === "drafting"
                    ? "drafting"
                    : session.phase === "applying"
                      ? "generating"
                      : activeDraft && activeDraft.length > 0
                        ? "draft"
                        : "pending"}
                </Pill>
              }
            />
            {activeDraft && activeDraft.length > 0 ? (
              <ProjectionCanvasPane
                triage={triage}
                busy={
                  session.phase === "drafting" || session.phase === "applying"
                }
                canHandEdit={Boolean(pendingId)}
              />
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <p className="text-body-sm text-fg-2">
                  {session.phase === "drafting"
                    ? "Drafting the instruction…"
                    : session.phase === "applying"
                      ? "Generating the preview…"
                      : "Nothing drafted yet."}
                </p>
              </div>
            )}
          </div>

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
              entity="projection"
              highlightedEditId={highlightedEditId}
              edits={edits}
              onUndoEdit={triage.handleUndoEdit}
              input={chatInput}
              onInputChange={setChatInput}
            />
          </div>
        </div>
      </PageCard>
    </PageLayout>
  );
}
