import { ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColourSwatch, Mono, StatusPill } from "@/components/kalaido";

export interface Window {
  start: string;
  end: string;
}

export interface ActiveRotationCardProps {
  name: string;
  isReflection: boolean;
  entropy?: number;
  windows?: Window[];
  draft?: string;
  busy: boolean;
  hasCandidate: boolean;
  onSkip: () => void;
  onTweak?: () => void;
  onApprove: () => void;
}

function windowRange(windows: Window[]): string {
  if (windows.length === 0) return "";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const start = fmt(windows[0].start);
  const end = fmt(windows[windows.length - 1].end);
  return start === end ? start : `${start} → ${end}`;
}

export function ActiveRotationCard({
  name,
  isReflection,
  entropy = 0,
  windows = [],
  draft,
  busy,
  hasCandidate,
  onSkip,
  onTweak,
  onApprove,
}: ActiveRotationCardProps) {
  return (
    <div className="mb-3 flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/5 dark:shadow-black/40">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <ColourSwatch c={isReflection ? 3 : 1} size={16} />
          <span className="text-base font-semibold">{name}</span>
          <StatusPill kind="neutral">
            {isReflection ? "REFL" : "PROJ"}
          </StatusPill>
        </div>
        {isReflection
          ? windows.length > 0 && (
              <StatusPill kind="yellow">
                {windows.length} window
                {windows.length > 1 ? "s" : ""}
              </StatusPill>
            )
          : entropy > 0 && <StatusPill kind="yellow">{entropy} new</StatusPill>}
      </div>

      {isReflection ? (
        <div className="px-5 py-4">
          {windows.length > 0 ? (
            <div className="flex items-center gap-2.5">
              <ClockIcon className="size-4 text-fg-3" />
              <Mono className="text-[12px] text-fg-2">
                {windowRange(windows)} · auto-approved
              </Mono>
            </div>
          ) : (
            <p className="text-[13px] text-fg-2">
              Dependencies moved on — regenerate to catch up.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[280px] overflow-y-auto px-5 py-4">
          {draft ? (
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
              {draft}
            </div>
          ) : (
            <p className="text-[13px] text-fg-2">Generating draft…</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line bg-background px-4 py-3">
        <Button size="sm" variant="ghost" onClick={onSkip}>
          ↩ Skip for now
        </Button>
        <div className="flex gap-2">
          {!isReflection && (
            <Button
              size="sm"
              variant="outline"
              disabled={!hasCandidate}
              onClick={onTweak}
            >
              Tweak…
            </Button>
          )}
          <Button
            size="sm"
            variant="commit"
            disabled={busy || (!isReflection && !hasCandidate)}
            onClick={onApprove}
          >
            {isReflection ? "Generate · next ↓" : "Approve · next ↓"}
          </Button>
        </div>
      </div>
    </div>
  );
}
