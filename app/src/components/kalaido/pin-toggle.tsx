import { PinIcon, PinOffIcon } from "lucide-react";
import { cn } from "@/lib/css-utils";

/** Pin toggle for a list row or card. A span (not a button) since `ListRow` and
 *  `DocumentCard` are themselves buttons when clickable — nesting buttons is
 *  invalid. Stops propagation so the underlying row/card click never fires. */
export function PinToggle({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> — `ListRow` and `DocumentCard` render this inside their own button, and nesting interactive elements inside a button is invalid.
    <span
      role="button"
      tabIndex={0}
      aria-label={pinned ? "Unpin" : "Pin"}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-2",
        pinned ? "text-action-ink" : "text-fg-4 hover:text-fg-2",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
    >
      {pinned ? (
        <PinIcon className="size-3.5" />
      ) : (
        <PinOffIcon className="size-3.5" />
      )}
    </span>
  );
}
