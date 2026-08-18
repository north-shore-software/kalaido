import { useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  PageCard,
  PageHeader,
  PageLayout,
  PaneHeader,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  type ContextItem,
  ContextPicker,
  Pill,
  RefineChatPanel,
} from "@/components/kalaido";
import type { RefineSession } from "@/hooks/use-refine-session";
import { withContextItem } from "@/lib/mentions";

export interface ProjectionDraftEditorProps {
  session: RefineSession;
  projectionId: string;
  title: string;
  crumb: string[];
  initialContext?: ContextItem[];
  onCancel: () => void;
  onApproveSuccess: (id: string) => void;
}

/**
 * The `context | chat | live-preview` editor for drafting a projection through
 * a refinement chat. Used both when authoring a brand-new projection
 * ({@link NewProjection}) and when resuming an uncommitted draft
 * ({@link ProjectionDetail}) — the only difference is how the {@link RefineSession}
 * was opened (fresh `start` vs `resume`). The draft lives in the chat (as a
 * ```snapshot block) until Approve commits it and routes to the projection.
 */
export function ProjectionDraftEditor({
  session,
  projectionId,
  title,
  crumb,
  initialContext,
  onCancel,
  onApproveSuccess,
}: ProjectionDraftEditorProps) {
  const [context, setContext] = useState<ContextItem[]>(initialContext ?? []);

  const canApprove = session.preview.length > 0 && !session.committing;

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
          <ContextPicker
            entity="projection"
            value={context}
            onChange={setContext}
          />

          <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
            <RefineChatPanel
              session={session}
              title="Define via chat"
              context={context}
              onMention={(item) =>
                setContext((prev) => withContextItem(prev, item))
              }
            />
          </div>

          <div className="flex min-w-0 flex-[1.1] flex-col">
            <PaneHeader
              label="Live draft preview"
              status={
                <Pill tone="primary" dot>
                  {session.preview.length > 0 ? "draft" : "pending"}
                </Pill>
              }
            />
            <div className="flex-1 overflow-y-auto p-5">
              {session.preview.length > 0 ? (
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
                  {session.preview}
                </div>
              ) : (
                <p className="text-[13px] text-fg-2">Nothing drafted yet.</p>
              )}
            </div>
          </div>
        </div>
      </PageCard>
    </PageLayout>
  );
}
