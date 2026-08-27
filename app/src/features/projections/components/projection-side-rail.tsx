import type { ReactNode } from "react";
import { CheckIcon, ClockIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Timeline, type TimelineItem } from "@/components/kalaido";
import type { ProjectionStatusInfo } from "@/features/projections/status";

export interface ProjectionSideRailProps {
  readOnly: boolean;
  rotLoading: boolean;
  info: ProjectionStatusInfo | undefined;
  /** Set only while a pending candidate exists; navigates to its review. */
  onReviewCandidate?: () => void;
  /** In-scope fragments the pending candidate's resolved context misses. */
  newSinceCandidate?: number;
  /** Display names for `info.blockedBy`, in the same order. */
  blockedNames?: string[];
  regenerating: boolean;
  onRefresh: () => void;
  onBackToLive: () => void;
  timeline: TimelineItem[];
}

/** The right rail: the freshness card (driven by the server's rotation plan)
 *  and the snapshot timeline. */
export function ProjectionSideRail({
  readOnly,
  rotLoading,
  info,
  onReviewCandidate,
  newSinceCandidate = 0,
  blockedNames,
  regenerating,
  onRefresh,
  onBackToLive,
  timeline,
}: ProjectionSideRailProps) {
  // The live-view freshness card, chosen from the freshness plan. Null while
  // the plan is still loading so we never flash a misleading "Up to date".
  let freshnessCard: ReactNode = null;
  if (rotLoading && !info) {
    freshnessCard = null;
  } else if (info?.status === "generating") {
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <RefreshCwIcon className="size-4 animate-spin text-fg-3" />
          <span className="text-item font-semibold">Generating…</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          A new candidate is being generated. It will appear here for review
          when it's ready.
        </p>
      </div>
    );
  } else if (info?.status === "pending" && onReviewCandidate) {
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
          A candidate is awaiting review.
          {newSinceCandidate > 0 && (
            <>
              {" "}
              <span className="text-drifting-ink">
                {newSinceCandidate} new fragment
                {newSinceCandidate > 1 ? "s" : ""} arrived since it was
                generated
              </span>{" "}
              — refresh to fold them in.
            </>
          )}
        </p>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="w-full" onClick={onReviewCandidate}>
            Review candidate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={onRefresh}
            disabled={regenerating}
          >
            {regenerating ? "Refreshing…" : "Refresh candidate"}
          </Button>
        </div>
      </div>
    );
  } else if (info?.status === "preparing") {
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <ClockIcon className="size-4 text-fg-3" />
          <span className="text-item font-semibold">Preparing</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          This projection's lens is still being prepared. Refresh will be
          available in a moment.
        </p>
      </div>
    );
  } else if (info?.status === "blocked") {
    // Refreshing now would build on output that is about to be superseded, and
    // the server refuses it, so this card explains instead of offering a button.
    const waitingOn =
      blockedNames && blockedNames.length > 0
        ? blockedNames.join(", ")
        : "an upstream input";
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <ClockIcon className="size-4 text-fg-3" />
          <span className="text-item font-semibold">Waiting upstream</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          {waitingOn} {blockedNames && blockedNames.length > 1 ? "have" : "has"}{" "}
          changes still to approve. Approve those first — refreshing now would
          use output that is about to change.
        </p>
      </div>
    );
  } else if (info?.status === "stale") {
    freshnessCard = (
      <div className="rounded-none border border-drifting/45 bg-drifting-wash p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <RefreshCwIcon className="size-4 text-drifting-ink" />
          <span className="text-item font-semibold text-fg-1">Refresh</span>
        </div>
        <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
          Generate an updated candidate from this projection’s current context,
          then review it before it goes live.
        </p>
        <Button
          size="sm"
          className="w-full"
          onClick={onRefresh}
          disabled={regenerating}
        >
          {regenerating ? "Refreshing…" : "Refresh projection"}
        </Button>
      </div>
    );
  } else {
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-1 flex items-center gap-2.5">
          <CheckIcon className="size-4 text-section-ink" />
          <span className="text-item font-semibold">Up to date</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          No new context in scope.
        </p>
      </div>
    );
  }

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
        freshnessCard
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
