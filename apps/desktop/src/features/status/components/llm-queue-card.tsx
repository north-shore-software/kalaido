import { Label, Pill, SurfaceCard } from "@kalaido/primitives/kalaido";
import { RobotIcon } from "@phosphor-icons/react";
import { queueHeldLabels } from "@/components/layout/queue-labels";

interface QueueTask {
  role: string;
  priority: string;
  model: string;
  started: string;
  tokens?: number;
  tokens_per_second?: number;
}

function keyRunningTasks(tasks: readonly QueueTask[]) {
  const counts = new Map<string, number>();
  return tasks.map((task) => {
    const base = `${task.role}\0${task.priority}\0${task.model}\0${task.started}`;
    const occurrence = counts.get(base) ?? 0;
    counts.set(base, occurrence + 1);
    return { key: `${base}#${occurrence}`, task };
  });
}

function deriveQueueTelemetry(queueDoc: Record<string, unknown> | undefined) {
  const state = (queueDoc?.state as string | undefined) ?? "idle";
  const isQueueActive = state === "active";
  const runningTasks = ((isQueueActive ? queueDoc?.running : []) ??
    []) as QueueTask[];
  const waitingCounts = ((isQueueActive ? queueDoc?.waiting : {}) ??
    {}) as Record<string, number>;
  const totalWaiting = Object.values(waitingCounts).reduce((a, b) => a + b, 0);
  const held = queueDoc?.held as { reason?: string } | null | undefined;
  const heldReason = held?.reason
    ? (queueHeldLabels[held.reason] ?? held.reason)
    : undefined;
  return { state, isQueueActive, runningTasks, totalWaiting, heldReason };
}

export interface LlmQueueCardProps {
  queueDoc: Record<string, unknown> | undefined;
  tokensPerSecond: number | undefined;
}

export function LlmQueueCard({ queueDoc, tokensPerSecond }: LlmQueueCardProps) {
  const { state, isQueueActive, runningTasks, totalWaiting, heldReason } =
    deriveQueueTelemetry(queueDoc);

  return (
    <SurfaceCard className="flex shrink-0 flex-col gap-3">
      <div className="flex items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <RobotIcon className="size-4 text-fg-3" />
          <Label>LLM Queue Telemetry</Label>
        </div>
        <div className="flex items-center gap-2 font-mono text-mono-sm">
          <Pill tone={isQueueActive ? "primary" : "muted"} dot={isQueueActive}>
            {state}
          </Pill>
          {tokensPerSecond !== undefined && (
            <span className="text-fg-4">
              ~{tokensPerSecond.toFixed(0)} tok/s
            </span>
          )}
        </div>
      </div>

      {runningTasks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-meta font-mono text-fg-4">Running Tasks</span>
          <div className="flex flex-col gap-1.5">
            {keyRunningTasks(runningTasks).map(({ key, task: t }) => (
              <div
                key={key}
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
          <span className="text-status-critical-ink">Held: {heldReason}</span>
        )}
      </div>
    </SurfaceCard>
  );
}
