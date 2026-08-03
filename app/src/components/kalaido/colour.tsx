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
  value,
  size = 12,
  className,
  style,
}: {
  c?: number;
  /**
   * A colour's stored `value`: a Tailwind background class (e.g. `bg-pink-500`)
   * or a raw CSS colour (e.g. `#deadbeef`, `rgb(...)`, a named colour). Takes
   * precedence over `c` when set — classes are appended to `className`, CSS
   * colours are applied via `style.backgroundColor`.
   */
  value?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const isClass = value?.startsWith("bg-");
  const bgClass =
    value == null ? contentColour(c) : isClass ? value : undefined;
  const bgStyle =
    value != null && !isClass ? { backgroundColor: value } : undefined;
  return (
    <span
      className={cn("inline-block shrink-0 rounded-sm", bgClass, className)}
      style={{ width: size, height: size, ...bgStyle, ...style }}
    />
  );
}
