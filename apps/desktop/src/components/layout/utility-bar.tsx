import {
  ArrowsClockwiseIcon,
  CompassIcon,
  MoonIcon,
  PaletteIcon,
  SparkleIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useScopeContext } from "@kalaido/hooks/create-scope-context";
import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useOrganizeStatus } from "@kalaido/hooks/use-organize-status";
import { Pill } from "@kalaido/primitives/kalaido";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { resolveTheme } from "@kalaido/primitives/lib/theme";
import { useTheme } from "@kalaido/primitives/providers/theme-provider";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useEffect, useState } from "react";
import type { SidecarStatus } from "@/api/app/local-scopes";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { DesktopScopeContext } from "@/state/app-state.ts";
import { queueHeldLabels } from "./queue-labels";
import { phaseLabel } from "./sidecar-status";
import { SidecarStatusDot } from "./sidecar-status-dot";
import { utilityBarTransitions } from "./utility-bar.transitions";

/**
 * Reports what the workspace is doing. Its only controls are the theme toggle
 * and the worker cluster, which is a shortcut to the Status page rather than a
 * way to act on the pipeline.
 */
export function UtilityBar() {
  const currentKalaidoscope = useActiveKalaidoscope();
  const isLocal = currentKalaidoscope?.type === "local_file";
  const root = useScopeContext(DesktopScopeContext);
  const sidecarScope = useScope({ from: root, state: ["sidecarStatus"] });
  const { sidecarStatus } = useScopeState(sidecarScope);

  return (
    <div className="relative flex h-8 shrink-0 items-center justify-between overflow-hidden border-t border-sidebar-border bg-sidebar px-3">
      {currentKalaidoscope ? (
        <QueueStatusLine isLocal={isLocal} sidecarStatus={sidecarStatus} />
      ) : (
        <div className="ml-auto flex items-center">
          <ThemeToggleMicroButton />
        </div>
      )}
    </div>
  );
}

type QueueTask = {
  role: string;
  priority: string;
  model: string;
  started: string;
  tokens?: number;
  tokens_per_second?: number;
};

const queueRoleLabels: Record<string, string> = {
  chat: "chat",
  refinement: "refining",
  snapshot: "generating",
  distill: "distilling lens",
  colour: "colour matching",
  map: "mapping",
  annotate: "annotating",
};

function QueueIndicator({
  badge,
  running,
  waitingCount,
  heldReason,
}: {
  badge: "FG" | "BG";
  running: QueueTask[];
  waitingCount: number;
  heldReason?: string;
}) {
  const active = running.length > 0;
  const roles = running
    .map((t) => queueRoleLabels[t.role] ?? t.role)
    .join(" + ");

  let statusText = "idle";
  if (active) {
    statusText = `${roles}${waitingCount > 0 ? ` · ${waitingCount} queued` : ""}`;
  } else if (waitingCount > 0) {
    statusText = `${waitingCount} queued${heldReason ? ` (${heldReason})` : ""}`;
  }

  return (
    <div
      className="flex items-center gap-1.5 font-mono text-mono-sm"
      title={
        active
          ? running
              .map((t) => `${t.role} (${t.priority}): ${t.model}`)
              .join("\n")
          : undefined
      }
    >
      <Pill tone={active ? "primary" : "muted"} dot={active}>
        {badge}
      </Pill>
      <span className={active ? "text-fg-2" : "text-fg-4"}>{statusText}</span>
    </div>
  );
}

function RateMeter({
  liveRate,
  finishedRate,
}: {
  liveRate: number;
  finishedRate?: number;
}) {
  const active = liveRate > 0;
  let text = "idle";
  if (active) {
    text = `~${liveRate.toFixed(0)} tok/s`;
  } else if (finishedRate !== undefined) {
    text = `${finishedRate.toFixed(1)} tok/s`;
  }

  return (
    <div
      className="flex items-center gap-1.5 font-mono text-mono-sm"
      title="LLM generation throughput"
    >
      <span className="text-fg-4">RATE</span>
      <span
        className={cn(
          "size-1.5 rounded-full",
          active
            ? "bg-stable animate-pulse"
            : finishedRate !== undefined
              ? "bg-stable/60"
              : "bg-fg-5",
        )}
      />
      <span className={active ? "font-medium text-fg-2" : "text-fg-4"}>
        {text}
      </span>
    </div>
  );
}

function WorkerCluster() {
  const { go } = useAppNavigate();
  const { status: organize } = useOrganizeStatus();

  const isMapActive =
    organize?.map.state === "consolidating" ||
    organize?.map.state === "annotating";
  const isDiscoverActive = organize?.discover.state === "running";
  const isColourActive = Boolean(organize?.colour?.draining);
  const isReconcileActive = Boolean(organize?.reconcile.running);

  const mapTitle = `Mapping: ${organize?.map.state ?? "idle"}${
    organize?.map.annotated !== undefined
      ? ` (${organize.map.annotated}/${organize.fragments ?? 0})`
      : ""
  }`;

  const discoverTitle = `Discover: ${organize?.discover.state ?? "idle"}${
    organize?.discover.running ? ` (${organize.discover.running})` : ""
  }`;

  const colourTitle = `Colour: ${
    organize?.colour?.draining ? "draining" : "idle"
  }${
    organize?.colour?.unjudgedFragments !== undefined
      ? ` (${organize.colour.unjudgedFragments} unjudged)`
      : ""
  }`;

  const reconcileTitle = `Reconcile: ${
    organize?.reconcile.running ? "running" : "idle"
  }`;

  return (
    <button
      type="button"
      onClick={() => go(utilityBarTransitions.transitions.openStatus)}
      className="flex items-center gap-2 px-1.5 py-0.5 transition-colors hover:bg-sidebar-accent cursor-pointer"
      title="Workspace pipeline status"
    >
      <span
        title={mapTitle}
        className={cn(
          "flex items-center transition-colors",
          isMapActive ? "text-fg-1 animate-pulse" : "text-fg-5",
        )}
      >
        <CompassIcon className="size-3.5" />
      </span>
      <span
        title={discoverTitle}
        className={cn(
          "flex items-center transition-colors",
          isDiscoverActive ? "text-fg-1 animate-pulse" : "text-fg-5",
        )}
      >
        <SparkleIcon className="size-3.5" />
      </span>
      <span
        title={colourTitle}
        className={cn(
          "flex items-center transition-colors",
          isColourActive ? "text-fg-1 animate-pulse" : "text-fg-5",
        )}
      >
        <PaletteIcon className="size-3.5" />
      </span>
      <span
        title={reconcileTitle}
        className={cn(
          "flex items-center transition-colors",
          isReconcileActive ? "text-fg-1 animate-spin" : "text-fg-5",
        )}
      >
        <ArrowsClockwiseIcon className="size-3.5" />
      </span>
    </button>
  );
}

function QueueStatusLine({
  isLocal,
  sidecarStatus,
}: {
  isLocal: boolean;
  sidecarStatus: SidecarStatus;
}) {
  const { records } = useLiveCollection("llm_queue_status");
  const root = useScopeContext(DesktopScopeContext);
  const rateScope = useScope({ from: root, state: ["latestInferenceRate"] });
  const { latestInferenceRate } = useScopeState(rateScope);

  const [, forceTick] = useState(0);
  const rateAt = latestInferenceRate?.at;
  useEffect(() => {
    if (rateAt === undefined) return;
    const id = setTimeout(() => forceTick((n) => n + 1), 5000);
    return () => clearTimeout(id);
  }, [rateAt]);
  const finishedRate =
    latestInferenceRate !== undefined &&
    Date.now() - latestInferenceRate.at < 5000
      ? latestInferenceRate.tokensPerSecond
      : undefined;

  const status = records[0];
  const running = ((status?.state === "active" ? status?.running : []) ??
    []) as QueueTask[];
  const waiting = ((status?.state === "active" ? status?.waiting : {}) ??
    {}) as Record<string, number>;
  const held = (status as { held?: { reason?: string } | null } | undefined)
    ?.held;

  const fgRunning = running.filter((t) => t.priority === "interactive");
  const fgWaiting = waiting.interactive ?? 0;
  const fgHeld =
    fgWaiting > 0 && held?.reason ? queueHeldLabels[held.reason] : undefined;

  const liveRate = running.reduce(
    (sum, t) => sum + (t.tokens_per_second ?? 0),
    0,
  );

  return (
    <>
      <div className="flex items-center gap-3 shrink-0">
        <QueueIndicator
          badge="FG"
          running={fgRunning}
          waitingCount={fgWaiting}
          heldReason={fgHeld}
        />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 font-mono text-mono-sm">
        <RateMeter liveRate={liveRate} finishedRate={finishedRate} />
        {isLocal && (
          <span
            className="flex items-center gap-1.5 text-fg-4"
            title={`Database: ${sidecarStatus.message ?? phaseLabel(sidecarStatus.phase)}`}
          >
            <SidecarStatusDot phase={sidecarStatus.phase} />
            DB
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <WorkerCluster />
        <div className="h-3.5 w-px bg-line" />
        <ThemeToggleMicroButton />
      </div>
    </>
  );
}

function ThemeToggleMicroButton() {
  const { theme, setTheme } = useTheme();
  const isDark = resolveTheme(theme) === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex items-center px-1 py-0.5 text-fg-5 transition-colors hover:text-fg-2 cursor-pointer"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <SunIcon className="size-3.5" />
      ) : (
        <MoonIcon className="size-3.5" />
      )}
    </button>
  );
}
