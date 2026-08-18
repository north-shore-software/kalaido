import type { ComponentProps } from "react";
import { cn } from "@/lib/css-utils";

interface PillProps extends ComponentProps<"span"> {
  /** `primary` — accent badge ("active", "Recommended"). `muted` — neutral ("Coming soon"). */
  tone?: "primary" | "muted";
  dot?: boolean;
}

/**
 * A small uppercase accent badge. Distinct from `StatusPill`, which carries
 * semantic run status; this is a plain label chip.
 */
export function Pill({
  tone = "primary",
  dot,
  className,
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-none border px-1.5 py-[3px] font-mono text-pill font-semibold uppercase [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-2.5",
        tone === "primary"
          ? "border-section-edge bg-section-wash text-section-ink"
          : "border-line-strong text-fg-3 tracking-[0.08em]",
        className,
      )}
      {...props}
    >
      {dot && <span className="size-[5px] rounded-full bg-current" />}
      {children}
    </span>
  );
}
