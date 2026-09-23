import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/css-utils";

/** Pin toggle for a list row or card. A span (not a button) since `ListRow` and
 *  `DocumentCard` are themselves buttons when clickable — nesting buttons is
 *  invalid. Stops propagation so the underlying row/card click never fires. */
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
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> — `ListRow` and `DocumentCard` render this inside their own button, and nesting interactive elements inside a button is invalid.
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={pinned ? "Unpin" : "Pin"}
      aria-disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-none transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface-2",
        pinned ? "text-section-ink" : "text-fg-4 hover:text-fg-2",
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onToggle();
        }
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
    >
      {pinned ? (
        <PushPinIcon className="size-3.5" />
      ) : (
        <PushPinSlashIcon className="size-3.5" />
      )}
    </span>
  );
}
