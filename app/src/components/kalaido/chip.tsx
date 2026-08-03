import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";

/**
 * A pill-shaped toggle button for compact single/multi selection (frequency,
 * window, context kind).
 */
export function Chip({
  active,
  accent,
  children,
  onClick,
}: {
  active?: boolean;
  accent?: "cyan";
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? accent === "cyan"
            ? "border-action-ink text-action-ink"
            : "border-fg-3 bg-surface-2 text-foreground"
          : "border-border text-fg-3 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
