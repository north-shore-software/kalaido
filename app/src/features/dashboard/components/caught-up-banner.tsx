import { CheckIcon } from "lucide-react";

export function CaughtUpBanner() {
  return (
    <div className="rounded-none border border-stable/40 bg-stable-wash px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-none border border-line bg-surface-2">
            <CheckIcon className="size-5 text-stable" />
          </span>
          <div className="flex flex-col gap-0.5">
            <div className="text-card-title font-bold text-fg-1">
              You’re all caught up
            </div>
            <p className="text-body-sm text-fg-3">
              Every projection reflects the latest fragments. Nothing needs your
              attention right now.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
