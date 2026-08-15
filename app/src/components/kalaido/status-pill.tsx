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
  stable: "border-stable/45 bg-stable-wash text-stable-ink",
  drifting: "border-drifting/45 bg-drifting-wash text-drifting-ink",
  critical: "border-critical/45 bg-critical-wash text-critical-ink",
  yellow: "border-yellow/45 bg-yellow-wash text-yellow-ink",
  magenta: "border-magenta/45 bg-magenta-wash text-magenta-ink",
  cyan: "border-cyan/45 bg-cyan-wash text-cyan-ink",
  neutral: "border-line-strong text-fg-3 tracking-[0.08em]",
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
        "inline-flex items-center gap-1 rounded-none border px-1.5 py-[3px] font-mono text-pill font-semibold uppercase",
        KIND[kind],
        className,
      )}
    >
      {dot && <span className="size-[5px] rounded-full bg-current" />}
      {children}
    </span>
  );
}
