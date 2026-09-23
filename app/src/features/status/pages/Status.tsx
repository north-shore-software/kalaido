import {
  BotIcon,
  CompassIcon,
  LayersIcon,
  PaletteIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { useSnapshot } from "valtio/react";
import { type DiscoverKind, startDiscover } from "@/api/kalaidoscope/discover";
import { startMap } from "@/api/kalaidoscope/map";
import { startReconcile } from "@/api/kalaidoscope/reconcile";
import {
  EmptyState,
  Label,
  Pill,
  StatusPill,
  SurfaceCard,
} from "@/components/kalaido";
import {
  PageCard,
  PageHeader,
  PageLayout,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { appState } from "@/hooks/use-app-state";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { useOrganizeStatus } from "@/hooks/use-organize-status";
import { defineRoute } from "@/routes/route-kit";
import { useEventLog } from "../hooks/use-event-log";
import { statusTransitions } from "./Status.transitions";

interface QueueTask {
  role: string;
  priority: string;
  model: string;
  started: string;
  tokens?: number;
  tokens_per_second?: number;
}

export default function StatusPage() {
  const { status: organize } = useOrganizeStatus();
  const { records: queueRecords } = useLiveCollection("llm_queue_status");
  const { latestInferenceRate } = useSnapshot(appState);
  const events = useEventLog();

  const [startingMap, setStartingMap] = useState(false);
  const [startingDiscover, setStartingDiscover] = useState<string | null>(null);
  const [startingReconcile, setStartingReconcile] = useState(false);

  const queueDoc = queueRecords[0];
  const isQueueActive = queueDoc?.state === "active";
  const runningTasks = ((isQueueActive ? queueDoc?.running : []) ??
    []) as QueueTask[];
  const waitingCounts = ((isQueueActive ? queueDoc?.waiting : {}) ??
    {}) as Record<string, number>;
  const totalWaiting = Object.values(waitingCounts).reduce((a, b) => a + b, 0);
  const heldReason = queueDoc?.held ? String(queueDoc.held) : undefined;

  async function handleStartMap() {
    setStartingMap(true);
    try {
      await startMap();
    } finally {
      setStartingMap(false);
    }
  }

  async function handleStartDiscover(kind: DiscoverKind) {
    setStartingDiscover(kind);
    try {
      await startDiscover(kind);
    } finally {
      setStartingDiscover(null);
    }
  }

  async function handleStartReconcile() {
    setStartingReconcile(true);
    try {
      await startReconcile();
    } finally {
      setStartingReconcile(false);
    }
  }

  return (
    <PageLayout>
      <PageHeader title="Status" crumb={["Status"]} />
      <PageCard className="p-5">
        <div className="flex min-h-0 flex-1 gap-5 overflow-hidden">
          <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-0.5">
            <SurfaceCard className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
                  <CompassIcon className="size-4" />
                  Mapping
                </span>
                <Pill
                  tone={
                    organize?.map.state === "consolidating" ||
                    organize?.map.state === "annotating"
                      ? "primary"
                      : "muted"
                  }
                >
                  {organize?.map.state ?? "idle"}
                </Pill>
              </div>
              <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
                <span>
                  Annotated: {organize?.map.annotated ?? 0} /{" "}
                  {organize?.fragments ?? 0}
                </span>
                <span>
                  Pending annotation: {organize?.map.pendingAnnotation ?? 0}
                </span>
                <span>Unconsolidated: {organize?.map.unconsolidated ?? 0}</span>
              </div>
              {organize?.map.lastDrainError && (
                <p className="truncate font-mono text-mono-sm text-critical-ink">
                  {organize.map.lastDrainError}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-auto justify-center"
                disabled={
                  startingMap || organize?.map.state === "consolidating"
                }
                onClick={handleStartMap}
              >
                {startingMap ? (
                  <Spinner />
                ) : (
                  <PlayIcon className="mr-1.5 size-3.5" />
                )}
                Run map
              </Button>
            </SurfaceCard>

            <SurfaceCard className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
                  <SparklesIcon className="size-4" />
                  Discover
                </span>
                <Pill
                  tone={
                    organize?.discover.state === "running" ? "primary" : "muted"
                  }
                >
                  {organize?.discover.state ?? "idle"}
                </Pill>
              </div>
              <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
                <span>Running: {organize?.discover.running || "none"}</span>
                <span>
                  Pending: {organize?.discover.pending?.join(", ") || "none"}
                </span>
                <span>Due: {organize?.discover.due?.join(", ") || "none"}</span>
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={
                    startingDiscover !== null ||
                    organize?.discover.state === "running"
                  }
                  onClick={() => handleStartDiscover("colours")}
                >
                  {startingDiscover === "colours" ? <Spinner /> : null}
                  Colours
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={
                    startingDiscover !== null ||
                    organize?.discover.state === "running"
                  }
                  onClick={() => handleStartDiscover("projections")}
                >
                  {startingDiscover === "projections" ? <Spinner /> : null}
                  Projections
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={
                    startingDiscover !== null ||
                    organize?.discover.state === "running"
                  }
                  onClick={() => handleStartDiscover("reflections")}
                >
                  {startingDiscover === "reflections" ? <Spinner /> : null}
                  Reflections
                </Button>
              </div>
            </SurfaceCard>

            <SurfaceCard className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
                  <PaletteIcon className="size-4" />
                  Colour
                </span>
                <Pill tone={organize?.colour?.draining ? "primary" : "muted"}>
                  {organize?.colour?.draining ? "draining" : "idle"}
                </Pill>
              </div>
              <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
                <span>
                  Unjudged: {organize?.colour?.unjudgedFragments ?? 0}
                </span>
                <span>
                  Total colours: {organize?.colour?.totalColoursCount ?? 0}
                </span>
                <span>
                  Prompt colours: {organize?.colour?.promptColoursCount ?? 0}
                </span>
              </div>
            </SurfaceCard>

            <SurfaceCard className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-meta font-medium text-fg-3">
                  <RefreshCwIcon className="size-4" />
                  Reconcile
                </span>
                <Pill tone={organize?.reconcile.running ? "primary" : "muted"}>
                  {organize?.reconcile.running ? "running" : "idle"}
                </Pill>
              </div>
              <div className="mt-1 flex flex-col gap-1 font-mono text-mono-sm text-fg-4">
                <span>
                  Wave: {organize?.reconcile.running ? "active" : "dormant"}
                </span>
                <span>
                  Started:{" "}
                  {organize?.reconcile.lastStarted
                    ? new Date(
                        organize.reconcile.lastStarted,
                      ).toLocaleTimeString()
                    : "never"}
                </span>
              </div>
              {organize?.reconcile.lastError && (
                <p className="truncate font-mono text-mono-sm text-critical-ink">
                  {organize.reconcile.lastError}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-auto justify-center"
                disabled={startingReconcile || organize?.reconcile.running}
                onClick={handleStartReconcile}
              >
                {startingReconcile ? (
                  <Spinner />
                ) : (
                  <RefreshCwIcon className="mr-1.5 size-3.5" />
                )}
                Reconcile
              </Button>
            </SurfaceCard>
          </div>

          <div className="flex flex-1 min-w-0 min-h-0 flex-col gap-4 overflow-hidden">
            <SurfaceCard className="flex shrink-0 flex-col gap-3">
              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <div className="flex items-center gap-2">
                  <BotIcon className="size-4 text-fg-3" />
                  <Label>LLM Queue Telemetry</Label>
                </div>
                <div className="flex items-center gap-2 font-mono text-mono-sm">
                  <Pill
                    tone={isQueueActive ? "primary" : "muted"}
                    dot={isQueueActive}
                  >
                    {queueDoc?.state ?? "idle"}
                  </Pill>
                  {latestInferenceRate && (
                    <span className="text-fg-4">
                      ~{latestInferenceRate.tokensPerSecond.toFixed(0)} tok/s
                    </span>
                  )}
                </div>
              </div>

              {runningTasks.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-meta font-mono text-fg-4">
                    Running Tasks
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {runningTasks.map((t, idx) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are a pure derivation of the queue status document
                        key={`${t.role}-${t.started}-${idx}`}
                        className="flex items-center justify-between border border-line bg-surface-2 px-3 py-2 font-mono text-mono-sm"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Pill tone="muted">{t.role}</Pill>
                          <span className="truncate text-fg-1">{t.model}</span>
                        </div>
                        <span className="ml-2 shrink-0 text-meta text-fg-4">
                          {t.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-2 text-meta font-mono text-fg-4">
                  No LLM tasks currently running.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-2.5 font-mono text-mono-sm text-fg-4">
                <span>Queued waiters: {totalWaiting}</span>
                {heldReason && (
                  <span className="text-status-critical-ink">
                    Held: {heldReason}
                  </span>
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard className="flex flex-1 min-h-0 flex-col gap-3">
              <div className="flex shrink-0 items-center justify-between border-b border-line pb-2.5">
                <div className="flex items-center gap-2">
                  <LayersIcon className="size-4 text-fg-3" />
                  <Label>Event Log</Label>
                </div>
                <span className="font-mono text-mono-sm text-fg-4">
                  {events.length} recent events
                </span>
              </div>

              {events.length > 0 ? (
                <div className="flex flex-1 min-h-0 flex-col divide-y divide-line overflow-y-auto border border-line">
                  {events.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex shrink-0 items-center justify-between gap-4 bg-surface-2 px-3 py-2 font-mono text-mono-sm"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusPill kind={evt.statusKind}>
                          {evt.status ?? "event"}
                        </StatusPill>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-fg-1">
                            {evt.title}
                          </span>
                          {evt.subtitle && (
                            <span className="truncate text-meta text-fg-4">
                              {evt.subtitle}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-meta text-fg-4">
                        {new Date(evt.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState centered className="py-6">
                  No recorded events yet in this workspace.
                </EmptyState>
              )}
            </SurfaceCard>
          </div>
        </div>
      </PageCard>
    </PageLayout>
  );
}

export const statusRoute = defineRoute({
  id: "status",
  path: "/status",
  feature: "Status",
  requiredScope: ["kalaidoscope"],
  transitions: statusTransitions,
  Component: StatusPage,
});
