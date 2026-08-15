import type { ComponentProps } from "react";
import { cn } from "@/lib/css-utils";

interface PillProps extends ComponentProps<"span"> {
  /** `primary` — accent badge ("active", "Recommended"). `muted` — neutral ("Coming soon"). */
  tone?: "primary" | "muted";
}

/**
 * A small uppercase accent badge. Distinct from `StatusPill`, which carries
 * semantic run status; this is a plain label chip.
 */
export function Pill({ tone = "primary", className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        "rounded-none border px-1.5 py-[3px] font-mono text-pill font-semibold uppercase",
        tone === "primary"
          ? "border-cyan-edge bg-cyan-wash text-cyan-ink"
          : "border-line-strong text-fg-3 tracking-[0.08em]",
        className,
      )}
      {...props}
    />
  );
}
