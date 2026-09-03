import { RefreshCwIcon } from "lucide-react";
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
import { isPinned } from "@/lib/pins";

export interface StatusBadgeProps {
  info: ProjectionStatusInfo;
}

export function StatusBadge({ info }: StatusBadgeProps) {
  switch (info.status) {
    case "generating":
      return <Mono className="text-mono-sm text-fg-3">generating…</Mono>;
    case "preparing":
      return <Mono className="text-mono-sm text-fg-3">preparing lens…</Mono>;
    case "stale":
      return (
        <Mono className="text-mono-sm text-drifting-ink">
          {info.entropy > 0 ? `${info.entropy} new · stale` : "stale"}
        </Mono>
      );
    case "blocked":
      return <Mono className="text-mono-sm text-fg-3">blocked upstream</Mono>;
    default:
      return (
        <Mono className="text-mono-sm text-section-ink">✓ up to date</Mono>
      );
  }
}

export interface ProjCardProps {
  p: ProjectionResponse;
  candidateId?: string;
  /** In-scope fragments the pending candidate's resolved context misses. */
  newSinceCandidate?: number;
  status: ProjectionStatusInfo;
  brief: string;
  sources: SourceItem[];
  onOpen: (id: string) => void;
  onReview: (id: string, candidateId: string) => void;
  onTogglePin: (p: ProjectionResponse) => void;
}

export function ProjCard({
  p,
  candidateId,
  newSinceCandidate = 0,
  status,
  brief,
  sources,
  onOpen,
  onReview,
  onTogglePin,
}: ProjCardProps) {
  const pinned = isPinned(p.pinned_by);
  const action = candidateId ? (
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
        <RefreshCwIcon />
        Review candidate
      </Button>
      {newSinceCandidate > 0 && (
        <Mono className="text-mono-sm text-drifting-ink">
          {newSinceCandidate} new since candidate · stale
        </Mono>
      )}
    </>
  ) : (
    <StatusBadge info={status} />
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
      {brief ? (
        <p className="line-clamp-4 break-words text-meta text-fg-3 [text-wrap:pretty]">
          {brief}
        </p>
      ) : (
        <span className="text-meta text-fg-4 italic">No brief</span>
      )}
    </DocumentCard>
  );
}
