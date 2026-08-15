import type { Story } from "@ladle/react";
import { type StatusKind, StatusPill } from "./status-pill.tsx";

export default { title: "Kalaido / StatusPill" };

const KINDS: StatusKind[] = [
  "stable",
  "drifting",
  "critical",
  "yellow",
  "magenta",
  "cyan",
  "neutral",
];

export const AllKinds: Story = () => (
  <div className="flex flex-col gap-3 p-4 bg-background max-w-sm border rounded-lg">
    {KINDS.map((kind) => (
      <div key={kind} className="flex items-center justify-between">
        <span className="text-xs text-fg-3 font-mono">{kind}</span>
        <StatusPill kind={kind}>{kind}</StatusPill>
      </div>
    ))}
  </div>
);

export const AllKindsWithDot: Story = () => (
  <div className="flex flex-col gap-3 p-4 bg-background max-w-sm border rounded-lg">
    {KINDS.map((kind) => (
      <div key={kind} className="flex items-center justify-between">
        <span className="text-xs text-fg-3 font-mono">{kind} (dot)</span>
        <StatusPill kind={kind} dot>
          {kind}
        </StatusPill>
      </div>
    ))}
  </div>
);
