import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import { Button } from "@kalaido/primitives/shadcn/button";
import { ArrowsClockwiseIcon, ClockIcon } from "@phosphor-icons/react";
import type { ProjectionStatusInfo } from "../status";

export interface ProjectionFreshnessCardProps {
  freshnessLoading: boolean;
  info: ProjectionStatusInfo | undefined;
  generatedAt?: string;
  onReviewCandidate?: () => void;
  newSinceCandidate: number;
  staleDependencyNames?: string[];
  regenerating: boolean;
  revising: boolean;
  onRefresh: () => void;
  onRevise: () => void;
}

function describeIdleFreshness({
  info,
  generatedAt,
  staleDependencyNames,
}: {
  info: ProjectionStatusInfo | undefined;
  generatedAt?: string;
  staleDependencyNames?: string[];
}) {
  const entropy = info?.entropy ?? 0;
  const hasStaleDeps = Boolean(staleDependencyNames?.length);
  const updatedList = staleDependencyNames?.join(", ") ?? "";
  const verb =
    staleDependencyNames && staleDependencyNames.length > 1 ? "have" : "has";

  let body: string;
  if (entropy > 0 && hasStaleDeps) {
    body = `${entropy} new fragment${entropy === 1 ? "" : "s"} in scope, and ${updatedList} ${verb} been updated since.`;
  } else if (entropy > 0) {
    body = `${entropy} new fragment${entropy === 1 ? "" : "s"} in scope since.`;
  } else if (hasStaleDeps) {
    body = `${updatedList} ${verb} been updated since.`;
  } else if (info?.status === "stale") {
    body = "Its sources have changed since.";
  } else {
    body = "Nothing new in scope since.";
  }

  const heading = generatedAt
    ? `Generated ${formatShortDateTime(generatedAt)}`
    : "Not generated yet";
  return { heading, body };
}

function PendingCandidateCard({
  newSinceCandidate,
  onReviewCandidate,
}: {
  newSinceCandidate: number;
  onReviewCandidate: () => void;
}) {
  const arrivalSuffix =
    newSinceCandidate > 0
      ? ` ${newSinceCandidate} new fragment${newSinceCandidate > 1 ? "s" : ""} arrived since it opened.`
      : "";
  return (
    <div className="rounded-none border border-line p-3.5">
      <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
        {`An in-progress draft is open.${arrivalSuffix}`}
      </p>
      <Button size="sm" className="w-full" onClick={onReviewCandidate}>
        Resume draft
      </Button>
    </div>
  );
}

export function ProjectionFreshnessCard({
  freshnessLoading,
  info,
  generatedAt,
  onReviewCandidate,
  newSinceCandidate,
  staleDependencyNames,
  regenerating,
  revising,
  onRefresh,
  onRevise,
}: ProjectionFreshnessCardProps) {
  if (freshnessLoading && !info) return null;

  if (info?.status === "generating") {
    return (
      <div className="rounded-none border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2.5">
          <ArrowsClockwiseIcon className="size-4 animate-spin text-fg-3" />
          <span className="text-item font-semibold">Updating…</span>
        </div>
        <p className="text-body-sm leading-relaxed text-fg-2">
          Preparing an updated draft from your latest sources.
        </p>
      </div>
    );
  }

  if (info?.status === "pending" && onReviewCandidate) {
    return (
      <PendingCandidateCard
        newSinceCandidate={newSinceCandidate}
        onReviewCandidate={onReviewCandidate}
      />
    );
  }

  const idle = describeIdleFreshness({
    info,
    generatedAt,
    staleDependencyNames,
  });
  const isStale = info?.status === "stale";

  return (
    <div className="rounded-none border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2.5">
        <ClockIcon className="size-4 text-fg-3" />
        <span className="text-item font-semibold">{idle.heading}</span>
      </div>
      <p className="mb-3 text-body-sm leading-relaxed text-fg-2">{idle.body}</p>
      {isStale ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onRefresh}
          disabled={regenerating || revising}
        >
          {regenerating ? "Updating…" : "Update"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onRevise}
          disabled={revising || regenerating}
        >
          {revising ? "Opening…" : "Edit / Revise"}
        </Button>
      )}
    </div>
  );
}
