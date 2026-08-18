import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DocumentCard,
  Mono,
  PinToggle,
} from "@/components/kalaido";
import { isPinned } from "@/lib/pins";
import type { ProjectionStatusInfo } from "@/features/projections/status";
import type { ProjectionResponse } from "@/api/kalaidoscope/types";

export interface StatusBadgeProps {
  info: ProjectionStatusInfo;
}

export function StatusBadge({ info }: StatusBadgeProps) {
  switch (info.status) {
    case "stale":
      return (
        <Mono className="text-[10.5px] text-yellow-ink">
          {info.entropy > 0 ? `${info.entropy} new · stale` : "stale"}
        </Mono>
      );
    case "blocked":
      return <Mono className="text-[10.5px] text-fg-3">blocked upstream</Mono>;
    default:
      return (
        <Mono className="text-[10.5px] text-section-ink">✓ up to date</Mono>
      );
  }
}

export interface ProjCardProps {
  p: ProjectionResponse;
  candidateId?: string;
  status: ProjectionStatusInfo;
  onOpen: (id: string) => void;
  onReview: (id: string, candidateId: string) => void;
  onTogglePin: (p: ProjectionResponse) => void;
}

export function ProjCard({
  p,
  candidateId,
  status,
  onOpen,
  onReview,
  onTogglePin,
}: ProjCardProps) {
  const pinned = isPinned(p.pinned_by);
  return (
    <DocumentCard
      className="w-[252px]"
      onClick={() => onOpen(p.id)}
      leading={<span className="size-[13px] bg-section rounded-none shrink-0" />}
      title={p.name || "Untitled projection"}
      trailing={<PinToggle pinned={pinned} onToggle={() => onTogglePin(p)} />}
      lines={["100%", "90%", "96%", "58%"]}
      contentClassName="h-[90px]"
      footer={
        candidateId ? (
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
        ) : (
          <StatusBadge info={status} />
        )
      }
    />
  );
}
