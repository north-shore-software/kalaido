import { useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import {
  getLocalKalaidoscopeStatus,
  registerSidecarStatusChangeListener,
  type SidecarStatus,
} from "@/api/app/local-scopes";
import type { UnlistenFn } from "@/api/app/os-integrations.ts";
import { Pill } from "@/components/kalaido";
import { useActiveKalaidoscope } from "@/hooks/use-active-kalaidoscope";
import { appState } from "@/hooks/use-app-state.ts";
import { useLiveCollection } from "@/hooks/use-live-collection";
import { cn } from "@/lib/css-utils";
import { phaseLabel, SidecarStatusDot } from "./sidecar-status-dot";

/**
 * Status only — the bar reports what the workspace is doing and holds no
 * controls (appearance moved to Settings › Appearance).
 */
export function UtilityBar() {
  const currentKalaidoscope = useActiveKalaidoscope();
  const currentKalaidoscopeId = currentKalaidoscope?.id ?? null;
  const isLocal = currentKalaidoscope?.type === "local_file";

  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>({
    phase: "idle",
    id: null,
    message: null,
  });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      const result =
        await registerSidecarStatusChangeListener(setSidecarStatus);
      if (result.isErr()) return;
      if (cancelled) result.value();
      else unlisten = result.value;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Status events only fire on changes, so seed the current phase on mount /
  // kalaidoscope switch.
  useEffect(() => {
    if (!currentKalaidoscopeId || !isLocal) return;
    void (async () => {
      const result = await getLocalKalaidoscopeStatus(currentKalaidoscopeId);
      if (result.isOk()) setSidecarStatus(result.value);
    })();
  }, [currentKalaidoscopeId, isLocal]);

  return (
    <div className="relative flex h-8 shrink-0 items-center justify-between overflow-hidden border-t border-sidebar-border bg-sidebar px-3">
      {currentKalaidoscope ? (
        <QueueStatusLine isLocal={isLocal} sidecarStatus={sidecarStatus} />
      ) : (
        <div />
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

const queueHeldLabels: Record<string, string> = {
  backoff: "provider back-off",
  idle_blocked: "waiting for quiet",
  idle_quiet: "waiting for quiet",
  rate_spacing: "pacing",
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
              : "bg-muted-foreground/30",
        )}
      />
      <span className={active ? "font-medium text-fg-2" : "text-fg-4"}>
        {text}
      </span>
    </div>
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
  const { latestInferenceRate } = useSnapshot(appState);

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

  const bgRunning = running.filter(
    (t) => t.priority === "background" || t.priority === "idle",
  );
  const bgWaiting = (waiting.background ?? 0) + (waiting.idle ?? 0);
  const bgHeld =
    bgWaiting > 0 && held?.reason ? queueHeldLabels[held.reason] : undefined;

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

      <div className="flex items-center gap-3 shrink-0">
        <QueueIndicator
          badge="BG"
          running={bgRunning}
          waitingCount={bgWaiting}
          heldReason={bgHeld}
        />
      </div>
    </>
  );
}
