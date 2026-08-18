import { Pill } from "@/components/kalaido";
import { PaneHeader } from "@/components/layout/page-layout";
import { cn } from "@/lib/css-utils";

export interface LivePreviewPaneProps {
  started: boolean;
  preview?: string;
  className?: string;
}

export function LivePreviewPane({
  started,
  preview = "",
  className,
}: LivePreviewPaneProps) {
  return (
    <div className={cn("flex w-[322px] shrink-0 flex-col", className)}>
      <PaneHeader
        label="Live preview"
        status={
          <Pill tone="primary" dot>
            {preview.length > 0 ? "draft" : "pending"}
          </Pill>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        {!started ? (
          <p className="text-[13px] text-fg-2">
            Send a first message to generate a draft.
          </p>
        ) : preview.length > 0 ? (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
            {preview}
          </div>
        ) : (
          <p className="text-[13px] text-fg-2">Generating…</p>
        )}
      </div>
    </div>
  );
}
