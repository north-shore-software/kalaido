import { ArrowsClockwiseIcon, ClockIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Label, Timeline, type TimelineItem } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import type { ProjectionStatusInfo } from "@/features/projections/status";
import { formatShortDateTime } from "@/lib/datetime";

export interface ProjectionSideRailProps {
  readOnly: boolean;
  rotLoading: boolean;
  info: ProjectionStatusInfo | undefined;
  /** When the live output was generated; absent if it never has been. */
  generatedAt?: string;
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
  generatedAt,
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
          <ArrowsClockwiseIcon className="size-4 animate-spin text-fg-3" />
          <span className="text-item font-semibold">Generating…</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          A new candidate is being generated. It will appear here for review
          when it's ready.
        </p>
      </div>
    );
  } else if (info?.status === "pending" && onReviewCandidate) {
    const isEngagedOutdated = info.candidateEngaged && info.candidateOutdated;
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
          {isEngagedOutdated ? (
            <span className="text-drifting-ink">
              Your edited candidate is out of date
              {newSinceCandidate > 0 && ` · ${newSinceCandidate} new`}
            </span>
          ) : (
            <>
              A candidate is awaiting review.
              {newSinceCandidate > 0 &&
                ` ${newSinceCandidate} new fragment${
                  newSinceCandidate > 1 ? "s" : ""
                } arrived since it was generated.`}
            </>
          )}
        </p>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="w-full" onClick={onReviewCandidate}>
            Review candidate
          </Button>
          {!isEngagedOutdated && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={onRefresh}
              disabled={regenerating}
            >
              {regenerating ? "Regenerating…" : "Regenerate candidate"}
            </Button>
          )}
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
          This projection's lens is still being prepared. Regenerate will be
          available in a moment.
        </p>
      </div>
    );
  } else {
    // Freshness is information, not a call to action: say how old the live
    // output is and what has arrived since, and leave regenerating to the user.
    // The server still refuses to build on an upstream that is itself out of
    // date, so that one case names the upstream instead of offering a button
    // that would fail.
    const blocked = info?.status === "blocked";
    const waitingOn =
      blockedNames && blockedNames.length > 0
        ? blockedNames.join(", ")
        : "an upstream input";
    const entropy = info?.entropy ?? 0;
    const since =
      entropy > 0
        ? `${entropy} new fragment${entropy === 1 ? "" : "s"} in scope since.`
        : info?.status === "stale"
          ? "Its sources have changed since."
          : "Nothing new in scope since.";
    freshnessCard = (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <ClockIcon className="size-4 text-fg-3" />
          <span className="text-item font-semibold">
            {generatedAt
              ? `Generated ${formatShortDateTime(generatedAt)}`
              : "Not generated yet"}
          </span>
        </div>
        <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
          {since}
          {blocked &&
            ` It builds on ${waitingOn}, which ${
              blockedNames && blockedNames.length > 1 ? "need" : "needs"
            } regenerating first.`}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onRefresh}
          disabled={regenerating || blocked}
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </Button>
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
