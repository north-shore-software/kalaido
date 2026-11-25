import type { RefinePhase } from "@kalaido/client/kalaidoscope/refinements";
import { MarkdownContent } from "@kalaido/components";
import { useAutoScroll } from "@kalaido/hooks/use-auto-scroll";
import { Pill } from "@kalaido/primitives/kalaido";
import { PaneHeader } from "@kalaido/primitives/layout/page-primitives";
import { cn } from "@kalaido/primitives/lib/css-utils";
import type { ReactNode } from "react";

export interface LivePreviewPaneProps {
  started: boolean;
  preview?: string;
  /**
   * Where the current turn stands (see `RefineSession.phase`). Each drafting
   * turn is two model calls — the lens is written, then executed — and the
   * pane names the stage so the pre-preview delay reads as progress.
   */
  phase?: RefinePhase;
  /** Controls beside the status pill — the window selector on reflections. */
  header?: ReactNode;
  className?: string;
}

function previewPhasePillLabel(
  phase: RefinePhase,
  hasPreview: boolean,
): string {
  if (phase === "drafting") return "drafting";
  if (phase === "applying") return "generating";
  return hasPreview ? "draft" : "pending";
}

function emptyPreviewCopy(started: boolean, phase: RefinePhase): string {
  if (!started) return "Send a first message to generate a draft.";
  if (phase === "drafting") return "Drafting the instruction…";
  if (phase === "applying") return "Generating the preview…";
  return "Generating…";
}

export function LivePreviewPane({
  started,
  preview = "",
  phase = "idle",
  header,
  className,
}: LivePreviewPaneProps) {
  const { containerRef, onScroll } = useAutoScroll({
    active: phase === "applying",
    content: preview,
  });

  const hasPreview = preview.length > 0;

  return (
    <div className={cn("flex min-w-0 flex-[1.1] flex-col", className)}>
      <PaneHeader
        label="Live preview"
        status={
          <div className="flex min-w-0 items-center gap-2">
            {header}
            <Pill tone="primary" dot>
              {previewPhasePillLabel(phase, hasPreview)}
            </Pill>
          </div>
        }
      />
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-5"
      >
        {started && hasPreview ? (
          <div className="text-body leading-relaxed text-fg-1">
            <MarkdownContent streaming content={preview} />
          </div>
        ) : (
          <p className="text-body-sm text-fg-2">
            {emptyPreviewCopy(started, phase)}
          </p>
        )}
      </div>
    </div>
  );
}
