import type { ContextSpec } from "@kalaido/client/kalaidoscope/chat";
import { parseContextSpec } from "@kalaido/client/kalaidoscope/chat";
import { parseProjectionOutput } from "@kalaido/client/kalaidoscope/projections";
import type {
  ProjectionResponse,
  ProjectionSnapshotResponse,
} from "@kalaido/client/kalaidoscope/types";
import { formatShortDateTime } from "@kalaido/client/lib/datetime";
import type { ContextSources } from "@kalaido/hooks/use-context-sources";
import type { TimelineItem } from "@kalaido/primitives/kalaido";
import type { ProjectionSeed } from "./types";

export function buildForkSeed({
  mode,
  id,
  title,
  projection,
  liveSnapshot,
}: {
  mode: "refine" | "orthogonal";
  id: string;
  title: string;
  projection: ProjectionResponse | undefined;
  liveSnapshot: ProjectionSnapshotResponse | undefined;
}): ProjectionSeed {
  if (mode === "refine") {
    return {
      name: `${title} — next stage`,
      draft: "",
      contextSpec: { sourceProjectionIds: [id] },
    };
  }
  const parentSpec = projection?.current_context_spec;
  return {
    name: `${title} (fork)`,
    draft: liveSnapshot
      ? (parseProjectionOutput(liveSnapshot.output).content ?? "")
      : "",
    contextSpec: (parseContextSpec(parentSpec) ?? undefined) as
      | ContextSpec
      | undefined,
  };
}

export function buildSnapshotTimeline({
  id,
  snapshots,
  liveId,
  snapshotId,
  onReviewCandidate,
  onViewLive,
  onViewSnapshot,
}: {
  id: string;
  snapshots: readonly ProjectionSnapshotResponse[];
  liveId: string | undefined;
  snapshotId: string | undefined;
  onReviewCandidate: (id: string, snapshotId: string) => void;
  onViewLive: (id: string) => void;
  onViewSnapshot: (id: string, snapshotId: string) => void;
}): {
  timeline: TimelineItem[];
  historicalVersion: number | undefined;
} {
  const history = snapshots.filter((s) => s.status !== "discarded");
  const historicalVersionIndex = history.findIndex((s) => s.id === snapshotId);
  const historicalVersion =
    historicalVersionIndex >= 0
      ? history.length - historicalVersionIndex
      : undefined;

  const timeline: TimelineItem[] = history.map((snap, i) => {
    const version = history.length - i;
    const pending = snap.status === "pending_review";
    const isLive = snap.id === liveId;
    return {
      id: snap.id,
      label: `v${version}${pending ? " · candidate" : ""}`,
      note: formatShortDateTime(snap.created),
      current: isLive,
      pending,
      active: snap.id === (snapshotId ?? liveId),
      onClick: () => {
        if (pending) onReviewCandidate(id, snap.id);
        else if (isLive) onViewLive(id);
        else onViewSnapshot(id, snap.id);
      },
    };
  });

  return { timeline, historicalVersion };
}

export function resolveUpstreamNames(
  depIds: readonly string[] | undefined,
  sources: Pick<ContextSources, "projections" | "reflections">,
): string[] {
  if (!depIds?.length) return [];
  const byId = new Map(
    [...sources.projections, ...sources.reflections].map((o) => [o.id, o.name]),
  );
  return depIds.map((dep) => byId.get(dep) ?? "an upstream input");
}

export function buildDetailCrumb(
  title: string,
  readOnly: boolean,
  historicalVersion: number | undefined,
): string[] {
  if (!readOnly) return ["Projections", title];
  return [
    "Projections",
    title,
    historicalVersion ? `v${historicalVersion}` : "snapshot",
  ];
}

export function buildDraftNameSeed(
  resumed: boolean,
  projection: ProjectionResponse | undefined,
  resumedSuggestedName: string,
) {
  if (!resumed || !projection) return null;
  return {
    name: projection.name || "Untitled projection",
    userNamed:
      resumedSuggestedName !== "" && projection.name !== resumedSuggestedName,
  };
}

export function shouldRedirectToPendingReview({
  status,
  readOnly,
  hasLiveSnapshot,
  hasPendingCandidate,
  id,
}: {
  status: string;
  readOnly: boolean;
  hasLiveSnapshot: boolean;
  hasPendingCandidate: boolean;
  id: string;
}): boolean {
  return (
    status !== "loading" &&
    !readOnly &&
    !hasLiveSnapshot &&
    hasPendingCandidate &&
    Boolean(id)
  );
}

export function deriveHistoricalSnapshot(
  readOnly: boolean,
  records: readonly ProjectionSnapshotResponse[],
) {
  const historical = readOnly ? records[0] : undefined;
  const historicalContent = historical
    ? parseProjectionOutput(historical.output).content
    : undefined;
  return { historical, historicalContent };
}

export function deriveFreshnessSummary(args: {
  freshnessEntry:
    | {
        candidate?: { newFragmentIds?: readonly string[] };
      }
    | undefined;
  generating: boolean;
  regenerating: boolean;
  hasSnapshots: boolean;
  hasCurrentLens: boolean;
}) {
  return {
    generating: args.generating || args.regenerating,
    // Projections can always be updated/revised once a saved snapshot exists,
    // even while the async editorial brief is still distilling or empty.
    lensMissing: false,
    newSinceCandidate:
      args.freshnessEntry?.candidate?.newFragmentIds?.length ?? 0,
  };
}

export function shouldStartFreshWithUpdate(args: {
  newSinceCandidate: number;
  entropy: number;
  staleDependenciesCount: number;
}): boolean {
  return (
    args.newSinceCandidate > 0 ||
    args.entropy > 0 ||
    args.staleDependenciesCount > 0
  );
}

export function deriveDetailHeaderState({
  id,
  projection,
  liveSnapshot,
  pendingCandidate,
  readOnly,
  historicalVersion,
  draftName,
}: {
  id: string;
  projection: ProjectionResponse | undefined;
  liveSnapshot: ProjectionSnapshotResponse | undefined;
  pendingCandidate: ProjectionSnapshotResponse | undefined;
  readOnly: boolean;
  historicalVersion: number | undefined;
  draftName: string | null | undefined;
}) {
  const title = projection?.name || "Projection";
  return {
    title,
    draftTitle: draftName ?? title,
    crumb: buildDetailCrumb(title, readOnly, historicalVersion),
    canEdit: !readOnly && Boolean(id),
    generatedAt: liveSnapshot?.generated_at || liveSnapshot?.created,
    pendingCandidateId: pendingCandidate?.id,
  };
}
