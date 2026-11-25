import type { ReactNode } from "react";
import { cn } from "#lib/css-utils";
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
  const shell = "overflow-hidden rounded-none border border-line bg-card";

  const content = (
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
  );

  if (!onClick) {
    return (
      <div className={cn(shell, className)}>
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
        {content}
        {footer && <div className="p-3.5">{footer}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        shell,
        "relative cursor-pointer transition-colors hover:bg-surface-2/50 has-[[data-card-primary]:focus-visible]:ring-2 has-[[data-card-primary]:focus-visible]:ring-inset has-[[data-card-primary]:focus-visible]:ring-ring/50",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <button
            type="button"
            data-card-primary
            onClick={onClick}
            className="min-w-0 cursor-pointer truncate text-left text-row font-semibold text-fg-1 outline-none first-letter:uppercase after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </button>
        </div>
        {trailing && (
          <div className="relative z-10 pointer-events-none flex shrink-0 items-center gap-2 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            {trailing}
          </div>
        )}
      </div>
      {/* The footer supplies the card's bottom padding when present. */}
      {content}
      {footer && (
        <div className="relative z-10 pointer-events-none p-3.5 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {footer}
        </div>
      )}
    </div>
  );
}
