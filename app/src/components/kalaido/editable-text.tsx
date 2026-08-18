import { PencilLineIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/css-utils";

export interface EditableTextProps {
  value: string;
  /** Called with the trimmed new text; never with empty or unchanged text. */
  onCommit: (next: string) => void;
  /** Applied to both the display text and the editing input. */
  className?: string;
  "aria-label"?: string;
}

/**
 * Inline-editable text: renders as plain text (inheriting the surrounding
 * type) with a pencil affordance on hover; clicking swaps in an input styled
 * to match. Enter or blur commits, Escape cancels, and an empty or unchanged
 * submit reverts silently — the caller only ever sees real renames.
 */
export function EditableText({
  value,
  onCommit,
  className,
  "aria-label": ariaLabel,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape unmounts the input while it is focused; the resulting blur must
  // not commit, so cancellation is tracked outside the render cycle.
  const cancelled = useRef(false);

  function open() {
    cancelled.current = false;
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    if (cancelled.current) return;
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  }

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: the input replaces the text the user just clicked; focus must follow.
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setEditing(false);
          }
        }}
        aria-label={ariaLabel ?? "Edit name"}
        className={cn(
          "w-full min-w-0 [font:inherit] [letter-spacing:inherit] text-inherit bg-transparent outline-none border-b border-ring",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={ariaLabel ?? "Rename"}
      title="Rename"
      className={cn(
        "group inline-flex min-w-0 max-w-full items-baseline gap-2 text-left [font:inherit] text-inherit cursor-text",
        className,
      )}
    >
      <span className="truncate">{value}</span>
      <PencilLineIcon className="size-3.5 shrink-0 self-center text-fg-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
