import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
import { Lines } from "./bars";

interface DocumentCardProps {
  className?: string;
  leading?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
  lines?: (number | string)[];
  children?: ReactNode;
  contentClassName?: string;
  footer?: ReactNode;
  onClick?: () => void;
}

/**
 * A document preview card: a header (leading visuals + title, optional trailing
 * meta/status) over a faux-content box, with an optional footer. Backs the
 * dashboard pins and the projections grid.
 */
export function DocumentCard({
  className,
  leading,
  title,
  trailing,
  lines,
  children,
  contentClassName,
  footer,
  onClick,
}: DocumentCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <span className="truncate text-row font-semibold text-fg-1 first-letter:uppercase">
            {title}
          </span>
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        )}
      </div>
      {/* The footer supplies the card's bottom padding when present. */}
      <div className={cn("px-3.5", !footer && "pb-3.5")}>
        <div
          className={cn(
            "rounded-none border border-line bg-background p-3",
            contentClassName,
          )}
        >
          {children ??
            (lines && <Lines widths={lines} h={6} className="bg-surface-2" />)}
        </div>
      </div>
      {footer && <div className="p-3.5">{footer}</div>}
    </>
  );

  const shell = "overflow-hidden rounded-none border border-line bg-card";

  if (!onClick) {
    return <div className={cn(shell, className)}>{body}</div>;
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> — the `trailing` and `footer` slots render their own buttons, and nesting interactive elements inside a button is invalid.
    <div
      role="button"
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        shell,
        "cursor-pointer transition-colors hover:bg-surface-2/50",
        className,
      )}
    >
      {body}
    </div>
  );
}
