import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils.ts";

export function Label({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold tracking-[0.1em] text-fg-3 uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Monospace — "the voice of raw data": timestamps, counts, paths. */
export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
