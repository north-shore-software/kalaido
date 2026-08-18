import { ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mono, StatusPill } from "@/components/kalaido";

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
    <div className="mb-3 flex flex-1 flex-col overflow-hidden rounded-none border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={
              isReflection
                ? "size-4 bg-violet rounded-none shrink-0"
                : "size-4 bg-green rounded-none shrink-0"
            }
          />
          <span className="text-card-title font-bold text-fg-1">{name}</span>
          <StatusPill
            className={
              isReflection
                ? "border-violet/45 bg-violet/10 text-violet"
                : "border-green/45 bg-green/10 text-green"
            }
          >
            {isReflection ? "REFL" : "PROJ"}
          </StatusPill>
        </div>
        {isReflection
          ? windows.length > 0 && (
              <StatusPill kind="neutral">
                {windows.length} window
                {windows.length > 1 ? "s" : ""}
              </StatusPill>
            )
          : entropy > 0 && <StatusPill kind="drifting">{entropy} new</StatusPill>}
      </div>

      {isReflection ? (
        <div className="px-5 py-4">
          {windows.length > 0 ? (
            <div className="flex items-center gap-2.5">
              <ClockIcon className="size-4 text-fg-3" />
              <Mono className="text-meta text-fg-2">
                {windowRange(windows)} · auto-approved
              </Mono>
            </div>
          ) : (
            <p className="text-body-sm text-fg-2">
              Dependencies moved on — regenerate to catch up.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[280px] overflow-y-auto px-5 py-4">
          {draft ? (
            <div className="whitespace-pre-wrap text-body leading-relaxed text-fg-1">
              {draft}
            </div>
          ) : (
            <p className="text-body-sm text-fg-2">Generating draft…</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line bg-background px-4 py-3">
        <Button variant="ghost" onClick={onSkip}>
          ↩ Skip for now
        </Button>
        <div className="flex gap-2">
          {!isReflection && (
            <Button
              variant="outline"
              disabled={!hasCandidate}
              onClick={onTweak}
            >
              Tweak…
            </Button>
          )}
          <Button
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
