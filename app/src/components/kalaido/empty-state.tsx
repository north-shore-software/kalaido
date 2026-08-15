import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";

/** Inline fallback for empty lists and panes ("Loading…" / "No items yet").
 *  Smaller and quieter than `ui/empty` — use that one for large hero empty
 *  states with an icon and title. `centered` fills the parent and centers the
 *  message, for the "Select a …" placeholder panes. */
export function EmptyState({
  children,
  action,
  centered = false,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  centered?: boolean;
  className?: string;
}) {
  if (centered) {
    return (
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-3",
          className,
        )}
      >
        <p className="max-w-[60%] text-center text-body-sm text-fg-2">
          {children}
        </p>
        {action}
      </div>
    );
  }
  if (action) {
    return (
      <div className={cn("flex flex-col items-start gap-3", className)}>
        <p className="text-body-sm text-fg-2">{children}</p>
        {action}
      </div>
    );
  }
  return <p className={cn("text-body-sm text-fg-2", className)}>{children}</p>;
}
