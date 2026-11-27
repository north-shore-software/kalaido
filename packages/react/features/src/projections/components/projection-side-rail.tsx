import {
  Label,
  Timeline,
  type TimelineItem,
} from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import type { ProjectionStatusInfo } from "../status";
import { ProjectionFreshnessCard } from "./projection-freshness-card";

export interface ProjectionSideRailProps {
  readOnly: boolean;
  freshnessLoading: boolean;
  info: ProjectionStatusInfo | undefined;
  /** When the live output was generated; absent if it never has been. */
  generatedAt?: string;
  /** Set only while a pending candidate exists; navigates to its review. */
  onReviewCandidate?: () => void;
  /** In-scope fragments the pending candidate's resolved context misses. */
  newSinceCandidate?: number;
  /** Display names for `info.staleDependencies`, in the same order. */
  staleDependencyNames?: string[];
  regenerating: boolean;
  revising: boolean;
  onRefresh: () => void;
  onRevise: () => void;
  onBackToLive: () => void;
  timeline: TimelineItem[];
}

/** The right rail: the freshness card and the snapshot timeline. */
export function ProjectionSideRail({
  readOnly,
  freshnessLoading,
  info,
  generatedAt,
  onReviewCandidate,
  newSinceCandidate = 0,
  staleDependencyNames,
  regenerating,
  revising,
  onRefresh,
  onRevise,
  onBackToLive,
  timeline,
}: ProjectionSideRailProps) {
  return (
    <aside className="flex w-[312px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4">
      {readOnly ? (
        <div className="rounded-none border border-line p-3.5">
          <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
            You’re viewing a past snapshot. It’s read-only.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={onBackToLive}
          >
            Back to live
          </Button>
        </div>
      ) : (
        <ProjectionFreshnessCard
          freshnessLoading={freshnessLoading}
          info={info}
          generatedAt={generatedAt}
          onReviewCandidate={onReviewCandidate}
          newSinceCandidate={newSinceCandidate}
          staleDependencyNames={staleDependencyNames}
          regenerating={regenerating}
          revising={revising}
          onRefresh={onRefresh}
          onRevise={onRevise}
        />
      )}

      <div className="flex flex-col gap-2.5">
        <Label>Snapshot timeline</Label>
        {timeline.length > 0 ? (
          <Timeline items={timeline} />
        ) : (
          <p className="text-meta text-fg-4">No snapshots yet.</p>
        )}
      </div>
    </aside>
  );
}
