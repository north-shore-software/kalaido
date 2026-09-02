import type { ReactNode } from "react";
import type { RefinePhase } from "@/api/kalaidoscope/refinements";
import { MarkdownContent, Pill } from "@/components/kalaido";
import { PaneHeader } from "@/components/layout/page-layout";
import { cn } from "@/lib/css-utils";

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

export function LivePreviewPane({
  started,
  preview = "",
  phase = "idle",
  header,
  className,
}: LivePreviewPaneProps) {
  return (
    <div className={cn("flex w-[322px] shrink-0 flex-col", className)}>
      <PaneHeader
        label="Live preview"
        status={
          <div className="flex min-w-0 items-center gap-2">
            {header}
            <Pill tone="primary" dot>
              {phase === "drafting"
                ? "drafting"
                : phase === "applying"
                  ? "generating"
                  : preview.length > 0
                    ? "draft"
                    : "pending"}
            </Pill>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        {!started ? (
          <p className="text-body-sm text-fg-2">
            Send a first message to generate a draft.
          </p>
        ) : preview.length > 0 ? (
          <div className="text-body leading-relaxed text-fg-1">
            <MarkdownContent streaming content={preview} />
          </div>
        ) : (
          <p className="text-body-sm text-fg-2">
            {phase === "drafting"
              ? "Drafting the instruction…"
              : phase === "applying"
                ? "Generating the preview…"
                : "Generating…"}
          </p>
        )}
      </div>
    </div>
  );
}
