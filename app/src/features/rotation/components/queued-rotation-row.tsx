import { CheckIcon, ClockIcon } from "lucide-react";
import { cn } from "@/lib/css-utils";
import { Mono } from "@/components/kalaido";

export type QState = "done" | "current" | "todo";

export interface QNodeProps {
  state: QState;
  n: number;
  last?: boolean;
}

export function QNode({ state, n, last }: QNodeProps) {
  return (
    <div className="flex w-[26px] shrink-0 flex-col items-center">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-stable",
          state === "current" && "border-2 border-section-ink",
          state === "todo" && "border-2 border-fg-4",
        )}
      >
        {state === "done" ? (
          <CheckIcon className="size-3 text-white" strokeWidth={2.4} />
        ) : (
          <Mono
            className={cn(
              "text-xs font-semibold",
              state === "current" ? "text-section-ink" : "text-fg-4",
            )}
          >
            {n}
          </Mono>
        )}
      </span>
      {!last && <div className="min-h-4 w-0.5 flex-1 bg-line" />}
    </div>
  );
}

export interface QueuedRotationRowProps {
  name: string;
  dep?: string;
  n: number;
  last?: boolean;
}

export function QueuedRotationRow({
  name,
  dep,
  n,
  last,
}: QueuedRotationRowProps) {
  return (
    <div className="flex gap-4 opacity-50">
      <QNode state="todo" n={n} last={last} />
      <div className="mb-3 flex flex-1 items-center justify-between rounded-lg border border-dashed border-border px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-fg-2">{name}</span>
          {dep && <Mono className="text-[10.5px] text-fg-4">{dep}</Mono>}
        </div>
        <ClockIcon className="size-3.5 text-fg-4" />
      </div>
    </div>
  );
}
