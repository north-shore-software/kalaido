import { PaneHeader } from "@/components/layout/page-layout";
import { Pill } from "@/components/kalaido";

export function PlaceholderPreviewPane() {
  return (
    <div className="flex min-w-0 flex-[1.1] flex-col">
      <PaneHeader
        label="Live draft preview"
        status={
          <Pill tone="primary" dot>
            pending
          </Pill>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-[13px] text-fg-2">
          Send a first message to generate a draft.
        </p>
      </div>
    </div>
  );
}
