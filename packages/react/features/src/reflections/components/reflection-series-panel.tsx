import { regenerateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { Timeline } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import {
  ArrowsClockwiseIcon,
  FileTextIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type SeriesWindow,
  useReflectionSeries,
} from "../hooks/use-reflection-series";
import { currentWindowSpec, describeWindow } from "../schedule";
import {
  buildSeriesTimeline,
  refreshAllButtonLabel,
  refreshAllSuccessMessage,
  windowLabel,
} from "../window-display";
import { BackfillCard } from "./backfill-card";
import { EditWindowDialog } from "./edit-window-dialog";
import { ReflectionHeader } from "./reflection-header";
import { ReflectionLensDialog } from "./reflection-lens-dialog";
import { SchedulePill } from "./schedule-controls";
import { SelectedWindowView } from "./selected-window-view";

type RegenArgs = { kind: "single"; window: SeriesWindow } | { kind: "all" };

interface EditTarget {
  windowId: string;
  windowTitle: string;
  initialOutput: string;
}

/**
 * A reflection read as a series: pick a window, read or directly edit its
 * summary, inspect per-window revision history, edit the standing lens, or
 * regenerate under the current lens.
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
  const [lensDialogOpen, setLensDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

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
              onClick={() => setLensDialogOpen(true)}
            >
              <FileTextIcon />
              Lens
            </Button>
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
            onEdit={(w, initialOutput) =>
              setEditTarget({
                windowId: w.id,
                windowTitle: windowLabel(w),
                initialOutput,
              })
            }
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

      <ReflectionLensDialog
        open={lensDialogOpen}
        onOpenChange={setLensDialogOpen}
        reflectionId={reflectionId}
      />

      <EditWindowDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        reflectionId={reflectionId}
        windowId={editTarget?.windowId ?? ""}
        windowTitle={editTarget?.windowTitle ?? ""}
        initialOutput={editTarget?.initialOutput ?? ""}
      />
    </div>
  );
}
