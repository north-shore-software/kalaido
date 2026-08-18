import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { MarkdownContent, Segmented, StatusPill } from "@/components/kalaido";
import { cn } from "@/lib/css-utils";
import { type DiffRow, diffMarkdown, segmentBlocks } from "@/lib/markdown-diff";

export interface SnapshotComparePaneProps {
  currentContent?: string;
  pendingContent?: string;
  refining?: boolean;
}

const COMPARE_VIEWS = ["split", "unified"] as const;
type CompareView = (typeof COMPARE_VIEWS)[number];

/**
 * The full-height column split, painted on the scroll container so the
 * pending side's veil and the separator run to the bottom even below short
 * content: 1px line + 3px magenta ending exactly at the 50% column boundary.
 * Horizontal-only, so scrolling never shears it.
 */
const SPLIT_BACKGROUND =
  "[background:linear-gradient(90deg,transparent_calc(50%-4px),var(--color-line)_calc(50%-4px),var(--color-line)_calc(50%-3px),var(--color-magenta)_calc(50%-3px),var(--color-magenta)_50%,var(--color-magenta-veil)_50%)]";

/** A whole removed/added block needs no inline tags — the wrapper is the diff voice. */
function BlockMarkdown({
  row,
  side,
}: {
  row: DiffRow;
  side: "left" | "right" | "merged";
}) {
  const md =
    side === "left" ? row.left : side === "right" ? row.right : row.merged;
  if (md === undefined) return null;
  if (row.kind === "removed") {
    return (
      <div className="bg-critical-wash text-critical-ink line-through">
        <MarkdownContent content={md} />
      </div>
    );
  }
  if (row.kind === "added") {
    return (
      <div className="bg-stable-wash text-stable-ink">
        <MarkdownContent content={md} />
      </div>
    );
  }
  return <MarkdownContent content={md} />;
}

export function SnapshotComparePane({
  currentContent,
  pendingContent,
  refining = false,
}: SnapshotComparePaneProps) {
  const [view, setView] = useState<CompareView>("split");
  // Refinement drafts re-deliver the whole document on every stream tick;
  // deferring the pending side lets React coalesce bursts of re-diffs.
  const deferredPending = useDeferredValue(pendingContent ?? "");
  const current = currentContent ?? "";

  const rows = useMemo<DiffRow[]>(() => {
    // An empty candidate is "nothing yet", not "everything deleted" — show
    // the current document plain rather than a wall of removals.
    if (deferredPending === "") {
      return segmentBlocks(current).map((block) => ({
        kind: "same" as const,
        left: block,
      }));
    }
    return diffMarkdown(current, deferredPending);
  }, [current, deferredPending]);

  const pill = (
    <StatusPill kind="magenta">{refining ? "refined" : "pending"}</StatusPill>
  );
  const toggle = (
    <Segmented items={COMPARE_VIEWS} value={view} onChange={setView} />
  );

  if (view === "unified") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-magenta-edge border-l-[3px] border-l-magenta bg-magenta-veil px-5">
          {pill}
          {toggle}
        </div>
        <div className="flex-1 overflow-y-auto border-l-[3px] border-l-magenta bg-magenta-veil px-5 py-4 text-fg-1">
          {rows.length === 0 && (
            <span className="text-fg-4">(empty candidate)</span>
          )}
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are a pure derivation of the two documents
            <div key={i} className="py-1.5 first:pt-0">
              <BlockMarkdown
                row={row}
                side={
                  row.kind === "modified"
                    ? "merged"
                    : row.kind === "removed"
                      ? "left"
                      : "right"
                }
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-stretch">
        <div className="flex flex-1 items-center border-b border-line px-5">
          <span className="flex items-center gap-1.5 font-mono text-label font-semibold text-fg-3 uppercase">
            <span className="size-[5px] rounded-full bg-fg-3" />
            current
          </span>
        </div>
        <div className="flex flex-1 items-center justify-between border-b border-magenta-edge border-l-[3px] border-l-magenta bg-magenta-veil px-5">
          {pill}
          {toggle}
        </div>
      </div>
      <div className={cn("flex-1 overflow-y-auto", SPLIT_BACKGROUND)}>
        {/* Matching blocks share a grid row, so alignment is structural and
            one scrollbar keeps both sides in sync. */}
        <div className="grid grid-cols-2 py-2.5">
          {!current && (
            <>
              <div className="min-w-0 px-5 py-1.5">
                <span className="text-fg-4">No live snapshot yet.</span>
              </div>
              <div className="min-w-0 px-5 py-1.5" />
            </>
          )}
          {!pendingContent && (
            <>
              <div className="min-w-0 px-5 py-1.5" />
              <div className="min-w-0 px-5 py-1.5">
                <span className="text-fg-4">(empty candidate)</span>
              </div>
            </>
          )}
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are a pure derivation of the two documents
            <Fragment key={i}>
              <div className="min-w-0 px-5 py-1.5 text-fg-2">
                <BlockMarkdown row={row} side="left" />
              </div>
              <div className="min-w-0 px-5 py-1.5 text-fg-1">
                <BlockMarkdown row={row} side="right" />
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
