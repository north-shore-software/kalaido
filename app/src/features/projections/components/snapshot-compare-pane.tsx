import { PencilLineIcon } from "lucide-react";
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MarkdownContent, Segmented, StatusPill } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/css-utils";
import {
  candidateBlockIndexByRow,
  type DiffRow,
  diffMarkdown,
  segmentBlockRanges,
  segmentBlocks,
} from "@/lib/markdown-diff";

export interface SnapshotComparePaneProps {
  currentContent?: string;
  pendingContent?: string;
  refining?: boolean;
  /** Blocks of the pending side can be selected for a hand edit. */
  editable?: boolean;
  /** Called with the raw markdown of the selected block run, exactly as the candidate has it. */
  onEdit?: (oldText: string) => void;
}

/** Inclusive range of candidate block indexes. */
type BlockSelection = [number, number];

/** Wrapper that makes a candidate block selectable; a no-op when it is not. */
function SelectableCell({
  index,
  selection,
  editable,
  onSelect,
  className,
  children,
}: {
  index: number | null;
  selection: BlockSelection | null;
  editable: boolean;
  onSelect: (index: number, extend: boolean) => void;
  className: string;
  children: React.ReactNode;
}) {
  const selectable = editable && index !== null;
  const selected =
    selectable &&
    selection !== null &&
    index >= selection[0] &&
    index <= selection[1];
  if (!selectable) return <div className={className}>{children}</div>;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button cannot wrap block markdown
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        className,
        "cursor-pointer rounded-none",
        selected ? "bg-magenta-veil ring-1 ring-magenta" : "hover:bg-surface-2",
      )}
      onClick={(e) => onSelect(index, e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(index, e.shiftKey);
        }
      }}
    >
      {children}
    </div>
  );
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
  editable = false,
  onEdit,
}: SnapshotComparePaneProps) {
  const [view, setView] = useState<CompareView>("split");
  // Refinement drafts re-deliver the whole document on every stream tick;
  // deferring the pending side lets React coalesce bursts of re-diffs.
  const deferredPending = useDeferredValue(pendingContent ?? "");
  const current = currentContent ?? "";

  // Block selection for a hand edit, as candidate block indexes. Any change
  // to the candidate text invalidates it — the indexes would point elsewhere.
  const [selection, setSelection] = useState<BlockSelection | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deferredPending is the reset trigger, not a read
  useEffect(() => setSelection(null), [deferredPending]);
  const ranges = useMemo(
    () => segmentBlockRanges(deferredPending),
    [deferredPending],
  );
  function select(index: number, extend: boolean) {
    setSelection((prev) => {
      if (extend && prev) {
        const anchor = prev[0];
        return [Math.min(anchor, index), Math.max(anchor, index)];
      }
      if (prev && prev[0] === index && prev[1] === index) return null;
      return [index, index];
    });
  }
  function editSelection() {
    if (!selection || !onEdit) return;
    const [a, b] = selection;
    onEdit(deferredPending.slice(ranges[a].start, ranges[b].end));
  }

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
  const rowIndex = useMemo(() => candidateBlockIndexByRow(rows), [rows]);

  const pill = (
    <StatusPill kind="magenta">{refining ? "refined" : "pending"}</StatusPill>
  );
  const toggle = (
    <div className="flex items-center gap-2">
      {editable && (
        <Button
          size="sm"
          variant="outline"
          disabled={!selection}
          onClick={editSelection}
          title="Select a block on the pending side (shift-click to extend), then edit it by hand"
        >
          <PencilLineIcon />
          Edit selection
        </Button>
      )}
      <Segmented items={COMPARE_VIEWS} value={view} onChange={setView} />
    </div>
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
            <SelectableCell
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are a pure derivation of the two documents
              key={i}
              index={rowIndex[i]}
              selection={selection}
              editable={editable}
              onSelect={select}
              className="py-1.5 first:pt-0"
            >
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
            </SelectableCell>
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
              <SelectableCell
                index={rowIndex[i]}
                selection={selection}
                editable={editable}
                onSelect={select}
                className="min-w-0 px-5 py-1.5 text-fg-1"
              >
                <BlockMarkdown row={row} side="right" />
              </SelectableCell>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
