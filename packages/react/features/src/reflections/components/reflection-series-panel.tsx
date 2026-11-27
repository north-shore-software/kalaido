import {
  discardReflectionDraft,
  regenerateReflection,
} from "@kalaido/client/kalaidoscope/reflections";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { ConfirmDialog, Timeline } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useExternalWrite } from "@kalaido/state/live";
import {
  ArrowsClockwiseIcon,
  FileTextIcon,
  SlidersHorizontalIcon,
  TrashIcon,
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
 * regenerate under the current lens. Never-saved reflections (`!current_lens_id`)
 * render a clean Draft in progress panel with Resume + Discard actions.
 */
export function ReflectionSeriesPanel({
  reflectionId,
  windowId,
  onSelectWindow,
  onRefine,
  onDiscarded,
}: {
  reflectionId: string;
  windowId?: string;
  onSelectWindow: (windowId: string) => void;
  onRefine: () => void;
  onDiscarded?: () => void;
}) {
  const client = useKalaidoscopeClient();
  const { reflection, windows, loading, error } =
    useReflectionSeries(reflectionId);
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [lensDialogOpen, setLensDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

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

  const discardWrite = useExternalWrite<string, void>({
    execute: async (id) =>
      (await discardReflectionDraft(id)).map(() => undefined),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "reflection"),
      kalaidoscopeCollectionTag(client.baseURL, "reflection_refinement"),
      kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
    ],
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

  async function confirmDiscard() {
    const outcome = await discardWrite.run(reflectionId);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to discard draft", {
        description: outcome.error.message,
      });
      return;
    }
    setDiscardOpen(false);
    onDiscarded?.();
  }

  const schedDisplay = describeWindow(
    currentWindowSpec(reflection?.window_spec_versions),
  );
  const isDraftInProgress = Boolean(reflection) && !reflection?.current_lens_id;

  if (isDraftInProgress) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ReflectionHeader
          reflectionId={reflectionId}
          name={reflection?.name}
          schedDisplay={schedDisplay}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-[460px] flex-col gap-4 border border-line bg-surface-1 p-6">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-card-title font-bold text-fg-1">
                Draft in progress
              </h2>
              <p className="text-body-sm text-fg-3">
                This reflection hasn’t been saved yet. Resume your tuning
                session to finish its standing lens and schedule, or discard
                this draft.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="section" onClick={onRefine}>
                <SlidersHorizontalIcon />
                Resume draft
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={discardWrite.isPending}
                onClick={() => setDiscardOpen(true)}
              >
                <TrashIcon />
                Discard draft
              </Button>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard reflection draft?"
          description="This reflection has never been saved. Discarding will permanently remove this unfinished draft and its conversation."
          confirmLabel={
            discardWrite.isPending ? "Discarding…" : "Discard draft"
          }
          variant="destructive"
          busy={discardWrite.isPending}
          onConfirm={() => void confirmDiscard()}
        />
      </div>
    );
  }

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
              Update
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
