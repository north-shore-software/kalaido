import type { CSSProperties } from "react";
import { cn } from "@/lib/css-utils";

/**
 * Placeholder primitives — the hi-fi mocks suggest body copy with neutral
 * bars rather than lorem text. Used in doc bodies, chat bubbles and card
 * previews to read as "content" without stubbing real prose.
 */
export function Bar({
  w = "100%",
  h = 9,
  className,
  style,
}: {
  w?: number | string;
  h?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("rounded-sm bg-surface-3", className)}
      style={{ width: w, height: h, ...style }}
    />
  );
}

export function Lines({
  widths = ["100%", "92%", "70%"],
  h = 8,
  gap = 8,
  className,
}: {
  widths?: (number | string)[];
  h?: number;
  gap?: number;
  className?: string;
}) {
  const rows = widths.map((w, i) => ({ w, key: `${i}-${w}` }));
  return (
    <div className="flex flex-col" style={{ gap }}>
      {rows.map((row) => (
        <Bar key={row.key} w={row.w} h={h} className={className} />
      ))}
    </div>
  );
}

/** A faux document body — title block + paragraphs. Mirrors the mock's KDoc. */
export function DocBody({
  paragraphs = 3,
  title = true,
  dense,
}: {
  paragraphs?: number;
  title?: boolean;
  dense?: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ gap: dense ? 14 : 18 }}>
      {title && (
        <div className="flex flex-col gap-2">
          <Bar w="58%" h={18} />
          <Bar w="30%" h={9} className="bg-surface-2" />
        </div>
      )}
      {Array.from({ length: paragraphs }, (_, i) => i).map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Bar w={120 + (i % 3) * 30} h={11} />
          <Lines
            widths={["100%", "96%", "99%", "70%"].slice(0, i % 2 ? 4 : 3)}
            h={7}
            className="bg-surface-2"
          />
        </div>
      ))}
    </div>
  );
}
