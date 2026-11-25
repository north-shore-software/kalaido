import type { ReactNode } from "react";
import { cn } from "#lib/css-utils";
import { fragmentTypeIcon } from "./icons";
import { StatusPill } from "./status-pill";
import { Mono } from "./text";

export function FragmentCard({
  type,
  title,
  time,
  preview,
  compact,
  rejected,
  onClick,
  className,
}: {
  type: string;
  title?: string;
  time?: ReactNode;
  colours?: number[];
  preview?: ReactNode;
  compact?: boolean;
  rejected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Icon = fragmentTypeIcon(type);
  const displayTitle = title || type;

  const classes = cn(
    "w-full min-w-0 rounded-none border border-line border-l-2 border-l-lime-edge bg-surface-1",
    compact ? "p-3" : "p-3.5",
    rejected && "opacity-50",
    onClick && "cursor-pointer text-left transition-colors hover:bg-surface-2",
    className,
  );

  const trailingMeta = rejected ? (
    <StatusPill kind="critical">rejected</StatusPill>
  ) : (
    time != null && (
      <Mono className="shrink-0 text-mono-sm text-fg-4">{time}</Mono>
    )
  );

  if (onClick) {
    return (
      <div
        className={cn(
          classes,
          "relative has-[[data-card-primary]:focus-visible]:ring-2 has-[[data-card-primary]:focus-visible]:ring-inset has-[[data-card-primary]:focus-visible]:ring-ring/50",
        )}
        data-testid="fragment-card"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
              <Icon className="size-3.5 text-lime" />
            </span>
            <button
              type="button"
              data-card-primary
              onClick={onClick}
              className="min-w-0 cursor-pointer truncate text-left text-body-sm font-semibold outline-none after:absolute after:inset-0 after:content-['']"
            >
              {displayTitle}
            </button>
          </div>
          {trailingMeta}
        </div>
        {preview && (
          <div className="mt-2 line-clamp-3 font-mono text-mono-sm leading-relaxed text-fg-4 break-words [word-break:break-word] [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">
            {preview}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={classes} data-testid="fragment-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
            <Icon className="size-3.5 text-lime" />
          </span>
          <span className="truncate text-body-sm font-semibold">
            {displayTitle}
          </span>
        </div>
        {trailingMeta}
      </div>
      {preview && (
        <div className="mt-2 line-clamp-3 font-mono text-mono-sm leading-relaxed text-fg-4 break-words [word-break:break-word]">
          {preview}
        </div>
      )}
    </div>
  );
}
