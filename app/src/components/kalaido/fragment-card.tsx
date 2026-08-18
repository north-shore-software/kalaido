import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
import { fragmentTypeIcon } from "./icons";
import { Mono } from "./text";
import { StatusPill } from "./status-pill";

export function FragmentCard({
  type,
  time,
  preview,
  compact,
  rejected,
  className,
}: {
  type: string;
  time?: ReactNode;
  colours?: number[];
  preview?: ReactNode;
  compact?: boolean;
  rejected?: boolean;
  className?: string;
}) {
  const Icon = fragmentTypeIcon(type);
  return (
    <div
      className={cn(
        "rounded-none border border-line border-l-2 border-l-lime-edge bg-surface-1",
        compact ? "p-3" : "p-3.5",
        rejected && "opacity-50",
        className,
      )}
      data-testid={"fragment-card"}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
            <Icon className="size-3.5 text-lime" />
          </span>
          <span className="truncate text-body-sm font-semibold">{type}</span>
        </div>
        {rejected ? (
          <StatusPill kind="critical">rejected</StatusPill>
        ) : (
          time != null && (
            <Mono className="shrink-0 text-mono-sm text-fg-4">{time}</Mono>
          )
        )}
      </div>
      {preview && (
        <p className="mt-2 font-mono text-mono-sm leading-relaxed text-fg-4">
          {preview}
        </p>
      )}
    </div>
  );
}
