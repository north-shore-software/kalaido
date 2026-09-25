import { PanelErrorBoundary } from "@/components/kalaido/panel-error-boundary";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import type { UseCandidateTriageResult } from "../hooks/use-candidate-triage";
import { ProjectionCanvas } from "./projection-canvas";

export interface ProjectionCanvasPaneProps {
  content?: string;
  triage: UseCandidateTriageResult;
  busy?: boolean;
  /** See ProjectionCanvas: stale candidate, decisions on proposals stay open. */
  frozen?: boolean;
  canHandEdit?: boolean;
  resetKey?: string;
}

export function ProjectionCanvasPane({
  content,
  triage,
  busy = false,
  frozen = false,
  canHandEdit = true,
  resetKey,
}: ProjectionCanvasPaneProps) {
  const { containerRef, onScroll } = useAutoScroll({
    active: triage.isStreamingPreview,
    content: triage.activeDraft,
  });

  return (
    <PanelErrorBoundary label="the canvas" resetKey={resetKey}>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-6"
      >
        <ProjectionCanvas
          content={content}
          draftContent={triage.activeDraft}
          edits={triage.edits}
          pending={true}
          busy={busy}
          frozen={frozen}
          onEditStatusChange={triage.handleEditStatusChange}
          onHandEdit={canHandEdit ? triage.handleHandEdit : undefined}
          onRefineEdit={triage.handleRefineEdit}
          onRefinePassage={triage.handleRefinePassage}
          onJumpToChatEvent={triage.handleJumpToChatEvent}
          activeEditId={triage.activeEditId}
        />
      </div>
    </PanelErrorBoundary>
  );
}
