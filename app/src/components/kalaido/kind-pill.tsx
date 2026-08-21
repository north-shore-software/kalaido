import { cn } from "@/lib/css-utils";
import { KIND_ABBREV } from "./context-bar/state";

export type PillKind = "projection" | "reflection";

const KIND_CLASS: Record<PillKind, string> = {
  projection: "border-green-edge bg-green-wash text-green-ink",
  reflection: "border-violet-edge bg-violet-wash text-violet-ink",
};

const KIND_LABEL: Record<PillKind, string> = {
  projection: KIND_ABBREV.Projection,
  reflection: KIND_ABBREV.Reflection,
};

export function KindPill({
  kind,
  className,
}: {
  kind: PillKind;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-none border px-1.5 py-[3px] font-mono text-pill font-semibold uppercase",
        KIND_CLASS[kind],
        className,
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
