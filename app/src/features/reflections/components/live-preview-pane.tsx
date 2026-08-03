import { Label, StatusPill } from "@/components/kalaido";
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
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <Label>Live preview</Label>
        <StatusPill kind="stable" dot={preview.length > 0}>
          {preview.length > 0 ? "draft" : "pending"}
        </StatusPill>
      </div>
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
