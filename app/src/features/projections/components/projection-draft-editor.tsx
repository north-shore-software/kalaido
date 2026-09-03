import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
import {
  type ContextItem,
  MarkdownContent,
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
import type { RefineSession } from "@/hooks/use-refine-session";
import { withContextItem } from "@/lib/mentions";

export interface ProjectionDraftEditorProps {
  session: RefineSession;
  projectionId: string;
  title: string;
  crumb: string[];
  initialContext?: ContextItem[];
  /** Makes the header title editable inline; see {@link PageHeader}. */
  onTitleCommit?: (next: string) => void;
  onCancel: () => void;
  onApproveSuccess: (id: string) => void;
}

/**
 * The `context | chat | live-preview` editor for drafting a projection through
 * a refinement chat. Used both when authoring a brand-new projection
 * ({@link NewProjection}) and when resuming an uncommitted draft
 * ({@link ProjectionDetail}) — the only difference is how the {@link RefineSession}
 * was opened (fresh `start` vs `resume`). The chat drafts a lens; the preview
 * shows that lens's executed output (the `apply_result` part), and Approve
 * commits lens + output together and routes to the projection.
 */
export function ProjectionDraftEditor({
  session,
  projectionId,
  title,
  crumb,
  initialContext,
  onTitleCommit,
  onCancel,
  onApproveSuccess,
}: ProjectionDraftEditorProps) {
  const [context, setContext] = useState<ContextItem[]>(
    initialContext ?? [WHOLE_SCOPE_ITEM],
  );

  const canApprove = session.previewReady && !session.committing;

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
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="commit"
              disabled={!canApprove}
              onClick={() => void approve()}
            >
              <CheckIcon />
              {session.committing ? "Approving…" : "Approve"}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
            <RefineChatPanel
              session={session}
              title="Define via chat"
              context={context}
              onMention={(item) =>
                setContext((prev) => withContextItem(prev, item))
              }
              onContextChange={setContext}
              entity="projection"
            />
          </div>

          <div className="flex min-w-0 flex-[1.1] flex-col">
            <PaneHeader
              label="Live draft preview"
              status={
                <Pill tone="primary" dot>
                  {session.phase === "drafting"
                    ? "drafting"
                    : session.phase === "applying"
                      ? "generating"
                      : session.preview.length > 0
                        ? "draft"
                        : "pending"}
                </Pill>
              }
            />
            <div className="flex-1 overflow-y-auto p-5">
              {session.preview.length > 0 ? (
                <div className="text-body leading-relaxed text-fg-1">
                  <MarkdownContent streaming content={session.preview} />
                </div>
              ) : (
                <p className="text-body-sm text-fg-2">
                  {session.phase === "drafting"
                    ? "Drafting the instruction…"
                    : session.phase === "applying"
                      ? "Generating the preview…"
                      : "Nothing drafted yet."}
                </p>
              )}
            </div>
          </div>
        </div>
      </PageCard>
    </PageLayout>
  );
}
