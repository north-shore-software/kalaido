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
        "rounded px-1.5 py-0.5 text-[0.625rem] uppercase",
        tone === "primary"
          ? "border border-primary/30 bg-primary/10 font-semibold tracking-widest text-primary"
          : "bg-surface-2 tracking-wide text-fg-4",
        className,
      )}
      {...props}
    />
  );
}
