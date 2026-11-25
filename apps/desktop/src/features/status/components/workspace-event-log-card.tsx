import {
  EmptyState,
  Label,
  StatusPill,
  SurfaceCard,
} from "@kalaido/primitives/kalaido";
import { StackIcon } from "@phosphor-icons/react";
import type { WorkspaceEvent } from "../hooks/use-event-log";

export interface WorkspaceEventLogCardProps {
  events: readonly WorkspaceEvent[];
}

export function WorkspaceEventLogCard({ events }: WorkspaceEventLogCardProps) {
  return (
    <SurfaceCard className="flex flex-1 min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <StackIcon className="size-4 text-fg-3" />
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
  );
}
