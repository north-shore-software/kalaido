import { regenerateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { formatWindowRange } from "@kalaido/client/lib/datetime";
import { MarkdownContent } from "@kalaido/components";
import {
  DocBody,
  EmptyState,
  StatusPill,
  Timeline,
  type TimelineItem,
} from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import {
  ArrowsClockwiseIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  parseReflectionOutput,
  type SeriesWindow,
  useReflectionSeries,
} from "../hooks/use-reflection-series";
import { currentWindowSpec, describeWindow } from "../schedule";
import { BackfillCard } from "./backfill-card";
import { ReflectionHeader } from "./reflection-header";
import { SchedulePill } from "./schedule-controls";

function windowLabel(w: SeriesWindow): string {
  return w.start && w.end ? formatWindowRange(w.start, w.end) : "All time";
}

function windowState(w: SeriesWindow): string {
  if (w.generating) return "generating…";
  if (!w.snapshot) return "no summary yet";
  if (w.olderLens) return "older lens";
  if (w.stale) return "new material";
  return "summary";
}

function refreshAllButtonLabel(busy: string | null, needsWork: number): string {
  if (busy === "all") return "Refreshing…";
  return needsWork > 0 ? `Refresh (${needsWork})` : "Refresh";
}

function windowActionLabel(busy: string | null, w: SeriesWindow): string {
  if (busy === w.id) return "Generating…";
  return w.snapshot ? "Regenerate" : "Generate";
}

function refreshAllSuccessMessage(count: number): string {
  if (count === 0) return "Everything is up to date";
  return `Regenerated ${count} ${count === 1 ? "summary" : "summaries"}`;
}

function buildSeriesTimeline(
  windows: readonly SeriesWindow[],
  selectedId: string | undefined,
  onSelectWindow: (id: string) => void,
): TimelineItem[] {
  return windows.map((w) => ({
    id: w.id,
    label: windowLabel(w),
    note: windowState(w),
    current: !!w.snapshot && !w.olderLens && !w.stale,
    pending: w.generating || !w.snapshot,
    active: selectedId === w.id,
    onClick: () => onSelectWindow(w.id),
  }));
}

type RegenArgs = { kind: "single"; window: SeriesWindow } | { kind: "all" };

function SelectedWindowView({
  error,
  loading,
  selected,
  busy,
  onRegenerate,
}: {
  error: Error | null | undefined;
  loading: boolean;
  selected: SeriesWindow | undefined;
  busy: string | null;
  onRegenerate: (w: SeriesWindow) => void;
}) {
  if (error) {
    return (
      <p className="text-body-sm text-destructive">
        Couldn’t load this reflection: {error.message}
      </p>
    );
  }
  if (loading && !selected) {
    return (
      <div className="max-w-[500px]">
        <DocBody paragraphs={3} />
      </div>
    );
  }
  if (!selected) {
    return (
      <EmptyState>
        No windows yet — the first summary appears once the lens is committed
        and a window completes.
      </EmptyState>
    );
  }

  const content = selected.snapshot
    ? parseReflectionOutput(selected.snapshot.output).content
    : undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="text-item font-semibold">{windowLabel(selected)}</span>
        {selected.generating && <StatusPill kind="cyan">generating</StatusPill>}
        {selected.olderLens && (
          <StatusPill kind="yellow">older lens</StatusPill>
        )}
        {selected.stale && !selected.olderLens && (
          <StatusPill kind="magenta">new material</StatusPill>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy !== null || selected.generating}
          onClick={() => onRegenerate(selected)}
        >
          {windowActionLabel(busy, selected)}
        </Button>
      </div>
      {selected.snapshot ? (
        <div className="max-w-[500px] text-body leading-relaxed text-fg-1">
          {content ? <MarkdownContent content={content} /> : "(empty snapshot)"}
        </div>
      ) : (
        <EmptyState>
          {selected.generating
            ? "Generating this window’s summary…"
            : "No summary for this window yet."}
        </EmptyState>
      )}
    </>
  );
}

/**
 * A reflection read as a series: pick a window, read its current summary,
 * regenerate it under the current lens. Refining the lens itself is the
 * separate refine screen; nothing here edits the lens.
 */
export function ReflectionSeriesPanel({
  reflectionId,
  windowId,
  onSelectWindow,
  onRefine,
}: {
  reflectionId: string;
  windowId?: string;
  onSelectWindow: (windowId: string) => void;
  onRefine: () => void;
}) {
  const { reflection, windows, loading, error } =
    useReflectionSeries(reflectionId);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);

  const regenWrite = useExternalWrite<
    RegenArgs,
    { readonly ids: readonly string[] }
  >({
    execute: (args) =>
      args.kind === "all"
        ? regenerateReflection(reflectionId, true, { all: true })
        : regenerateReflection(reflectionId, true, {
            ...(args.window.key ? { windowId: args.window.id } : {}),
          }),
    concurrency: "ignore",
  });

  const selected =
    windows.find((w) => w.id === windowId) ??
    windows.find((w) => w.snapshot) ??
    windows[0];
  const busy = regenWrite.isPending ? activeTarget : null;

  async function regenerate(w: SeriesWindow) {
    setActiveTarget(w.id);
    const outcome = await regenWrite.run({ kind: "single", window: w });
    if (outcome.status === "ignored") return;
    setActiveTarget(null);
    if (outcome.status === "error") {
      toast.error("Failed to regenerate", {
        description: outcome.error.message,
      });
      return;
    }
    toast.success("Summary regenerated");
  }

  async function refreshAll() {
    setActiveTarget("all");
    const outcome = await regenWrite.run({ kind: "all" });
    if (outcome.status === "ignored") return;
    setActiveTarget(null);
    if (outcome.status === "error") {
      toast.error("Failed to refresh", { description: outcome.error.message });
      return;
    }
    toast.success(refreshAllSuccessMessage(outcome.ids.length));
  }

  const schedDisplay = describeWindow(
    currentWindowSpec(reflection?.window_spec_versions),
  );
  const needsWork = windows.filter(
    (w) => !w.generating && (!w.snapshot || w.olderLens || w.stale),
  ).length;
  const timeline = buildSeriesTimeline(windows, selected?.id, onSelectWindow);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReflectionHeader
        reflectionId={reflectionId}
        name={reflection?.name}
        schedDisplay={schedDisplay}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || windows.length === 0}
              onClick={() => void refreshAll()}
            >
              <ArrowsClockwiseIcon />
              {refreshAllButtonLabel(busy, needsWork)}
            </Button>
            <Button size="sm" variant="section" onClick={onRefine}>
              <SlidersHorizontalIcon />
              Refine
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[260px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
          {windows.length === 0 ? (
            <p className="text-meta text-fg-4">
              {loading ? "Loading…" : "No windows yet."}
            </p>
          ) : (
            <Timeline items={timeline} tone="section" />
          )}
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          <SelectedWindowView
            error={error}
            loading={loading}
            selected={selected}
            busy={busy}
            onRegenerate={(w) => void regenerate(w)}
          />
        </div>

        <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4">
          <SchedulePill
            freq={schedDisplay.freq}
            win={schedDisplay.win}
            className="px-2.5 py-2"
          />
          {schedDisplay.scheduled && (
            <BackfillCard reflectionId={reflectionId} />
          )}
        </aside>
      </div>
    </div>
  );
}
