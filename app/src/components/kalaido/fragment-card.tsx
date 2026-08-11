import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
import { fragmentTypeIcon } from "./icons";
import { ColourSwatch } from "./colour";
import { Mono } from "./text";
import { StatusPill } from "./status-pill";

export function FragmentCard({
  type,
  time,
  colours = [],
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
        "rounded-lg border border-line border-l-2 border-l-ingest-line bg-card",
        compact ? "p-3" : "p-3.5",
        rejected && "opacity-50",
        className,
      )}
      data-testid={"fragment-card"}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2">
            <Icon className="size-3.5 text-fg-3" />
          </span>
          <span className="truncate text-[12.5px] font-semibold">{type}</span>
        </div>
        {rejected ? (
          <StatusPill kind="critical">rejected</StatusPill>
        ) : (
          time != null && (
            <Mono className="shrink-0 text-[11px] text-fg-4">{time}</Mono>
          )
        )}
      </div>
      {preview && (
        <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {preview}
        </p>
      )}
      {colours.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {colours
            .map((c, i) => ({ c, key: `${i}-${c}` }))
            .map((s) => (
              <ColourSwatch key={s.key} c={s.c} size={9} />
            ))}
        </div>
      )}
    </div>
  );
}
