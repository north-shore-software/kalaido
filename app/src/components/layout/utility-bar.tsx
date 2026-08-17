import { useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import type { UnlistenFn } from "@/api/app/os-integrations.ts";
import { appState } from "@/hooks/use-app-state.ts";
import { useActiveKalaidoscope } from "@/hooks/use-active-kalaidoscope";
import {
  getLocalKalaidoscopeStatus,
  registerSidecarStatusChangeListener,
  type SidecarStatus,
} from "@/api/app/local-scopes";
import { useLiveCollection } from "@/hooks/use-live-collection";
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
    <div className="flex h-8 shrink-0 items-center justify-end overflow-hidden border-t border-sidebar-border bg-sidebar px-3 gap-4">
      <div className="flex items-center gap-3 shrink-0">
        {/* Needs the workspace's PocketBase client, which only exists once a
            kalaidoscope is open — hence the mount gate rather than `enabled`. */}
        {currentKalaidoscope && <QueueStatusLine />}

        {isLocal && (
          <span
            className="flex items-center gap-1.5 font-mono text-mono-sm text-fg-4"
            title={`Database: ${sidecarStatus.message ?? phaseLabel(sidecarStatus.phase)}`}
          >
            <SidecarStatusDot phase={sidecarStatus.phase} />
            DB
          </span>
        )}
      </div>
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
};

/**
 * Permanent one-line summary of the LLM scheduler, from the server-maintained
 * `llm_queue_status` singleton (see kalaidoscope server/queue_status.go):
 * what's running, how much is queued, and live throughput. The in-flight
 * tok/s is a server-side estimate (~4 chars/token); the exact figure the
 * provider reports at completion shows against `idle` for a few seconds
 * afterwards.
 */
function QueueStatusLine() {
  const { records } = useLiveCollection("llm_queue_status");
  const { latestInferenceRate } = useSnapshot(appState);

  // Hide the post-run exact rate 5s after measurement. Valtio won't re-render
  // on elapsed time alone, so schedule a tick to force the hide.
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
  // No status record reachable (e.g. a workspace created before the collection
  // existed) — say nothing rather than claim "idle" without knowing.
  if (!status) return null;

  if (status.state !== "active") {
    return (
      <span className="font-mono text-mono-sm text-fg-4">
        {finishedRate !== undefined
          ? `idle · ${finishedRate.toFixed(1)} tok/s`
          : "idle"}
      </span>
    );
  }

  const running = (status.running ?? []) as QueueTask[];
  const waiting = (status.waiting ?? {}) as Record<string, number>;
  const queued = Object.values(waiting).reduce((a, b) => a + b, 0);
  const liveRate = running.reduce(
    (sum, t) => sum + (t.tokens_per_second ?? 0),
    0,
  );

  const parts: string[] = [];
  if (running.length > 0) {
    parts.push(
      running.map((t) => queueRoleLabels[t.role] ?? t.role).join(" + "),
    );
  }
  if (queued > 0) {
    parts.push(`${queued} queued`);
  }
  if (liveRate > 0) {
    parts.push(`~${liveRate.toFixed(0)} tok/s`);
  }

  return (
    <span
      className="font-mono text-mono-sm text-fg-4"
      title={running
        .map((t) => `${t.role} (${t.priority}): ${t.model}`)
        .join("\n")}
    >
      {parts.join(" · ")}
    </span>
  );
}
