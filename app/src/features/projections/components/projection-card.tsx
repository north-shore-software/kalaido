import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { ProjectionResponse } from "@/api/kalaidoscope/types";
import {
  DocumentCard,
  Mono,
  PinToggle,
  SourceList,
} from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import type { SourceItem } from "@/features/projections/sources";
import type { ProjectionStatusInfo } from "@/features/projections/status";
import { formatShortDateTime } from "@/lib/datetime";

export interface StatusBadgeProps {
  info: ProjectionStatusInfo;
  /** When the live output was generated; absent if it never has been. */
  generatedAt?: string;
}

/** How old the live output is — information, never a prompt to act. */
export function StatusBadge({ info, generatedAt }: StatusBadgeProps) {
  if (info.status === "generating")
    return <Mono className="text-mono-sm text-fg-3">generating…</Mono>;
  if (info.status === "preparing")
    return <Mono className="text-mono-sm text-fg-3">preparing lens…</Mono>;
  const parts = [
    generatedAt
      ? `generated ${formatShortDateTime(generatedAt)}`
      : "not generated yet",
  ];
  if (info.entropy > 0) parts.push(`${info.entropy} new since`);
  return <Mono className="text-mono-sm text-fg-3">{parts.join(" · ")}</Mono>;
}

export interface ProjCardProps {
  p: ProjectionResponse;
  /** When the live output was generated; absent if it never has been. */
  generatedAt?: string;
  candidateId?: string;
  /** In-scope fragments the pending candidate's resolved context misses. */
  newSinceCandidate?: number;
  status: ProjectionStatusInfo;
  description: string;
  sources: SourceItem[];
  onOpen: (id: string) => void;
  onReview: (id: string, candidateId: string) => void;
  onTogglePin: (p: ProjectionResponse) => void;
}

export function ProjCard({
  p,
  generatedAt,
  candidateId,
  newSinceCandidate = 0,
  status,
  description,
  sources,
  onOpen,
  onReview,
  onTogglePin,
}: ProjCardProps) {
  const pinned = Boolean(p.pinned);
  const isEngagedOutdated =
    status.status === "pending" &&
    status.candidateEngaged &&
    status.candidateOutdated;
  const showCandidateAction = candidateId && status.status === "pending";

  const action = showCandidateAction ? (
    <>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={(e) => {
          e.stopPropagation();
          onReview(p.id, candidateId);
        }}
      >
        <ArrowsClockwiseIcon />
        Review candidate
      </Button>
      {isEngagedOutdated ? (
        <Mono className="text-mono-sm text-drifting-ink">
          Your edited candidate is out of date
          {newSinceCandidate > 0 ? ` · ${newSinceCandidate} new` : ""}
        </Mono>
      ) : newSinceCandidate > 0 ? (
        <Mono className="text-mono-sm text-fg-3">
          {newSinceCandidate} new since candidate
        </Mono>
      ) : null}
    </>
  ) : (
    <StatusBadge info={status} generatedAt={generatedAt} />
  );
  return (
    <DocumentCard
      className="w-[300px]"
      onClick={() => onOpen(p.id)}
      leading={
        <span className="size-[13px] bg-section rounded-none shrink-0" />
      }
      title={p.name || "Untitled projection"}
      trailing={<PinToggle pinned={pinned} onToggle={() => onTogglePin(p)} />}
      contentClassName="h-[110px]"
      footer={
        <div className="flex flex-col gap-2">
          <SourceList sources={sources} />
          {action}
        </div>
      }
    >
      {description ? (
        <p className="line-clamp-4 break-words text-meta text-fg-3 [text-wrap:pretty]">
          {description}
        </p>
      ) : (
        <span className="text-meta text-fg-4 italic">No description</span>
      )}
    </DocumentCard>
  );
}
