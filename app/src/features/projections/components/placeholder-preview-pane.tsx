import { Pill } from "@/components/kalaido";
import { cn } from "@/lib/css-utils";
import { PaneHeader } from "@/components/layout/page-layout";

export function PlaceholderPreviewPane({
  className,
}: {
  className?: string;
} = {}) {
  return (
    <div className={cn("flex min-w-0 flex-[1.1] flex-col", className)}>
      <PaneHeader
        label="Live draft preview"
        status={
          <Pill tone="primary" dot>
            pending
          </Pill>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-body-sm text-fg-2">
          Send a first message to generate a draft.
        </p>
      </div>
    </div>
  );
}
