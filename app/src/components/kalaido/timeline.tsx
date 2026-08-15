import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils.ts";
import { StatusPill } from "./status-pill";
import { Mono } from "./text";

export interface TimelineItem {
  id: string;
  label: ReactNode;
  note?: ReactNode;
  current?: boolean;
  pending?: boolean;
  onClick?: () => void;
  active?: boolean;
}

/**
 * Vertical node-and-connector timeline. `magenta` for snapshot histories;
 * `stable` for auto-approved reflection runs.
 */
export function Timeline({
  items,
  tone = "magenta",
}: {
  items: TimelineItem[];
  tone?: "magenta" | "stable";
}) {
  const ring = tone === "stable" ? "border-stable" : "border-magenta";
  const fill = tone === "stable" ? "bg-stable" : "bg-magenta";
  return (
    <div className="flex flex-col">
      {items.map((it, i) => (
        <div key={it.id} className="flex gap-3">
          <div className="flex w-3 shrink-0 flex-col items-center">
            <span
              className={cn(
                "size-[11px] rounded-sm border-2",
                ring,
                it.pending ? "bg-card" : fill,
              )}
            />
            {i < items.length - 1 && (
              <div className="min-h-[22px] w-0.5 flex-1 bg-line" />
            )}
          </div>
          <TimelineEntry item={it} />
        </div>
      ))}
    </div>
  );
}

/**
 * The label/note column of a single entry. A real `<button>` when clickable —
 * the entry holds only text, so there is nothing interactive to nest.
 */
function TimelineEntry({ item }: { item: TimelineItem }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Mono
          className={cn(
            (item.current || item.active) && "font-semibold text-foreground",
          )}
        >
          {item.label}
        </Mono>
        {item.pending && <StatusPill kind="magenta">pending</StatusPill>}
      </div>
      {item.note && (
        <span className="font-mono text-[10.5px] text-fg-4">{item.note}</span>
      )}
    </>
  );

  const shell = "flex flex-col gap-0.5 pb-3.5";

  if (!item.onClick) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={item.onClick}
      className={cn(
        shell,
        "cursor-pointer rounded-sm text-left transition-colors hover:text-foreground",
      )}
    >
      {body}
    </button>
  );
}
