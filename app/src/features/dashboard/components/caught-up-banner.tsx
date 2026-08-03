import { CheckIcon } from "lucide-react";

export function CaughtUpBanner() {
  return (
    <div className="rounded-lg border border-stable bg-stable-wash px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-[46px] shrink-0 items-center justify-center rounded-[10px] bg-stable">
            <CheckIcon className="size-5 text-white" strokeWidth={2.2} />
          </span>
          <div className="flex flex-col gap-1">
            <div className="text-[18px] font-semibold tracking-tight">
              You’re all caught up
            </div>
            <p className="text-[12.5px] text-fg-3">
              Every projection reflects the latest fragments. Nothing needs your
              attention right now.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
