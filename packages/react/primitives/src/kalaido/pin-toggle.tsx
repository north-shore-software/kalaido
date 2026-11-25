import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { cn } from "#lib/css-utils";

/** Pin toggle for a list row or card. */
export function PinToggle({
  pinned,
  onToggle,
  disabled,
}: {
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={pinned ? "Unpin" : "Pin"}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-surface-2",
        pinned ? "text-section-ink" : "text-fg-4 hover:text-fg-2",
      )}
      onClick={onToggle}
    >
      {pinned ? (
        <PushPinIcon className="size-3.5" />
      ) : (
        <PushPinSlashIcon className="size-3.5" />
      )}
    </button>
  );
}
