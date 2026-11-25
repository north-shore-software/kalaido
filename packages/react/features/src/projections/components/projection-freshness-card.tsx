import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { Button } from "@kalaido/primitives/shadcn/button";
import { ArrowsClockwiseIcon, ClockIcon } from "@phosphor-icons/react";
import type { ProjectionStatusInfo } from "../status";

export interface ProjectionFreshnessCardProps {
  rotLoading: boolean;
  info: ProjectionStatusInfo | undefined;
  generatedAt?: string;
  onReviewCandidate?: () => void;
  newSinceCandidate: number;
  blockedNames?: string[];
  regenerating: boolean;
  onRefresh: () => void;
}

function describeIdleFreshness({
  info,
  generatedAt,
  blockedNames,
}: {
  info: ProjectionStatusInfo | undefined;
  generatedAt?: string;
  blockedNames?: string[];
}) {
  const blocked = info?.status === "blocked";
  const waitingOn =
    blockedNames && blockedNames.length > 0
      ? blockedNames.join(", ")
      : "an upstream input";
  const entropy = info?.entropy ?? 0;
  let since: string;
  if (entropy > 0) {
    since = `${entropy} new fragment${entropy === 1 ? "" : "s"} in scope since.`;
  } else if (info?.status === "stale") {
    since = "Its sources have changed since.";
  } else {
    since = "Nothing new in scope since.";
  }
  const blockedSuffix = blocked
    ? ` It builds on ${waitingOn}, which ${
        blockedNames && blockedNames.length > 1 ? "need" : "needs"
      } regenerating first.`
    : "";
  const heading = generatedAt
    ? `Generated ${formatShortDateTime(generatedAt)}`
    : "Not generated yet";
  return { blocked, heading, body: `${since}${blockedSuffix}` };
}

function PendingCandidateCard({
  isEngagedOutdated,
  newSinceCandidate,
  regenerating,
  onReviewCandidate,
  onRefresh,
}: {
  isEngagedOutdated: boolean;
  newSinceCandidate: number;
  regenerating: boolean;
  onReviewCandidate: () => void;
  onRefresh: () => void;
}) {
  const arrivalSuffix =
    newSinceCandidate > 0
      ? ` ${newSinceCandidate} new fragment${newSinceCandidate > 1 ? "s" : ""} arrived since it was generated.`
      : "";
  return (
    <div className="rounded-none border border-line p-3.5">
      <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
        {isEngagedOutdated ? (
          <span className="text-drifting-ink">
            Your edited candidate is out of date
            {newSinceCandidate > 0 && ` · ${newSinceCandidate} new`}
          </span>
        ) : (
          `A candidate is awaiting review.${arrivalSuffix}`
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
}

export function ProjectionFreshnessCard({
  rotLoading,
  info,
  generatedAt,
  onReviewCandidate,
  newSinceCandidate,
  blockedNames,
  regenerating,
  onRefresh,
}: ProjectionFreshnessCardProps) {
  if (rotLoading && !info) return null;

  if (info?.status === "generating") {
    return (
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
  }

  if (info?.status === "pending" && onReviewCandidate) {
    return (
      <PendingCandidateCard
        isEngagedOutdated={Boolean(
          info.candidateEngaged && info.candidateOutdated,
        )}
        newSinceCandidate={newSinceCandidate}
        regenerating={regenerating}
        onReviewCandidate={onReviewCandidate}
        onRefresh={onRefresh}
      />
    );
  }

  if (info?.status === "preparing") {
    return (
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
  }

  const idle = describeIdleFreshness({ info, generatedAt, blockedNames });
  return (
    <div className="rounded-none border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2.5">
        <ClockIcon className="size-4 text-fg-3" />
        <span className="text-item font-semibold">{idle.heading}</span>
      </div>
      <p className="mb-3 text-body-sm leading-relaxed text-fg-2">{idle.body}</p>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={onRefresh}
        disabled={regenerating || idle.blocked}
      >
        {regenerating ? "Regenerating…" : "Regenerate"}
      </Button>
    </div>
  );
}
