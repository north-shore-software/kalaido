import { Mono, Pill } from "@/components/kalaido";

export interface ReflectionHeaderProps {
  reflectionId: string;
  name?: string;
  schedDisplay: {
    freq: string;
    win: string;
    scheduled: boolean;
  };
  readOnly?: boolean;
}

export function ReflectionHeader({
  name,
  schedDisplay,
  readOnly,
}: ReflectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
      <div className="flex items-center gap-3">
        <span className="size-4 bg-section rounded-none shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">
            {name || "Untitled reflection"}
          </span>
          <Mono className="text-meta text-fg-4">
            {schedDisplay.freq} · last {schedDisplay.win} ·{" "}
            {schedDisplay.scheduled ? "auto-approved" : "manual"}
          </Mono>
        </div>
      </div>
      {!readOnly && <Pill tone="primary">latest</Pill>}
    </div>
  );
}
