import { ColourSwatch, Mono, StatusPill } from "@/components/kalaido";
import { swatchIndex } from "@/lib/colors";

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
  reflectionId,
  name,
  schedDisplay,
  readOnly,
}: ReflectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
      <div className="flex items-center gap-3">
        <ColourSwatch
          c={swatchIndex(reflectionId)}
          size={16}
          className="rounded-md"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">
            {name || "Untitled reflection"}
          </span>
          <Mono className="text-[11px] text-fg-4">
            {schedDisplay.freq} · last {schedDisplay.win} ·{" "}
            {schedDisplay.scheduled ? "auto-approved" : "manual"}
          </Mono>
        </div>
      </div>
      {!readOnly && (
        <StatusPill kind="stable" dot>
          latest
        </StatusPill>
      )}
    </div>
  );
}
