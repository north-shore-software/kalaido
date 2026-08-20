import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/css-utils";
import { Pill } from "./pill";

/**
 * The required-field pulse (Setup & onboarding forms). Submitting with a
 * required field empty does not disable the button — the field flashes this
 * critical treatment plus a "Required" pill, then the highlight clears and the
 * first missing field takes focus.
 *
 * Call sites append their own `pr-*` so the pill never overlaps the text.
 */
export const requiredHighlightClass =
  "border-b-critical focus-visible:border-b-critical focus:border-b-critical bg-critical/10 shadow-[0_0_12px_rgba(255,51,51,0.25)] ring-1 ring-critical/40";

/** The "Required" flag; position it with a `right-*` class. */
export function RequiredPill({ className }: { className?: string }) {
  return (
    <Pill
      className={cn(
        "pointer-events-none absolute border-critical/40 bg-critical/20 text-critical-ink animate-in fade-in duration-150",
        className,
      )}
    >
      Required
    </Pill>
  );
}

export function useRequiredHighlights<T extends string>(
  fieldIds: Record<T, string>,
) {
  const [highlighted, setHighlighted] = useState<ReadonlySet<T>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function trigger(fields: T[]) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setHighlighted(new Set(fields));
    timeoutRef.current = setTimeout(() => {
      setHighlighted(new Set());
      const firstMissing = fields[0];
      if (firstMissing !== undefined) {
        document.getElementById(fieldIds[firstMissing])?.focus();
      }
    }, 500);
  }

  return { highlighted, trigger };
}
