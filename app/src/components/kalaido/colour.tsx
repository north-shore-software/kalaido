import type { CSSProperties } from "react";
import { cn } from "@/lib/css-utils";

// Static class strings so Tailwind can see them at build time.
const CONTENT = [
  "bg-content-1",
  "bg-content-2",
  "bg-content-3",
  "bg-content-4",
  "bg-content-5",
  "bg-content-6",
  "bg-content-7",
  "bg-content-8",
] as const;

export function contentColour(c: number): string {
  return CONTENT[((c % CONTENT.length) + CONTENT.length) % CONTENT.length];
}

export function ColourSwatch({
  c = 0,
  size = 12,
  className,
  style,
}: {
  /** The colour's palette slot (`colour.swatch`). */
  c?: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-sm",
        contentColour(c),
        className,
      )}
      style={{ width: size, height: size, ...style }}
    />
  );
}
