import { cn } from "@/lib/css-utils";
import { ColourSwatch } from "./colour";
import { KindPill } from "./kind-pill";
import { Mono } from "./text";

export type SourceKind = "Colour" | "Projection" | "Reflection";

export interface SourceItem {
  kind: SourceKind;
  id: string;
  label: string;
  value?: string;
}

export interface SourceListProps {
  sources: SourceItem[];
  className?: string;
}

export function SourceList({ sources, className }: SourceListProps) {
  if (sources.length === 0) {
    return <Mono className="text-mono-sm text-fg-4">whole scope</Mono>;
  }
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}
    >
      {sources.map((s) => (
        <span
          key={`${s.kind}:${s.id}`}
          className="inline-flex max-w-full items-center gap-1"
        >
          {s.kind === "Colour" ? (
            <ColourSwatch value={s.value} size={8} />
          ) : (
            <KindPill
              kind={s.kind === "Projection" ? "projection" : "reflection"}
            />
          )}
          <Mono className="truncate text-mono-sm text-fg-2">{s.label}</Mono>
        </span>
      ))}
    </div>
  );
}
