import type { ReactNode } from "react";
import { cn } from "../../lib/css-utils";

export type StatusKind =
  | "stable"
  | "drifting"
  | "critical"
  | "yellow"
  | "magenta"
  | "cyan"
  | "neutral";

const KIND: Record<StatusKind, string> = {
  stable: "bg-stable-wash text-stable-ink",
  drifting: "bg-drifting-wash text-drifting-ink",
  critical: "bg-critical-wash text-critical-ink",
  yellow: "bg-yellow-wash text-yellow-ink",
  magenta: "bg-magenta-wash text-magenta-ink",
  cyan: "bg-cyan-wash text-cyan-ink",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Wash-filled status pill. The accent kinds (yellow/magenta/cyan) and the
 * momentum kinds (stable/drifting/critical) share one shape.
 */
export function StatusPill({
  kind = "neutral",
  dot,
  children,
  className,
}: {
  kind?: StatusKind;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-[0.06em] uppercase",
        KIND[kind],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
