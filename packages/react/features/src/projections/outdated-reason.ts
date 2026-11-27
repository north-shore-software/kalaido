export interface OutdatedCandidateCopy {
  outdatedReason: string;
  outdatedSince: string;
  gateDescription: string;
}

export function formatOutdatedCandidate({
  reason,
  newCount,
  generatedAt,
  engaged,
  hasUnresolvedEdits,
  proposedEditsCount,
}: {
  reason: string | undefined;
  newCount: number;
  generatedAt: string;
  engaged: boolean;
  hasUnresolvedEdits: boolean;
  proposedEditsCount: number;
}): OutdatedCandidateCopy {
  let outdatedReason: string;
  switch (reason) {
    case "new_fragments":
      outdatedReason = `${newCount} new fragment${newCount === 1 ? "" : "s"}`;
      break;
    case "lens_changed":
      outdatedReason = "lens changed";
      break;
    case "model_changed":
      outdatedReason = "model changed";
      break;
    default:
      outdatedReason = "context changed";
  }

  const outdatedSince =
    reason === "new_fragments"
      ? `${outdatedReason} arrived after this candidate was generated (${generatedAt}).`
      : `The ${outdatedReason} after this candidate was generated (${generatedAt}).`;

  let gateDescription: string;
  if (engaged) {
    const unresolvedHint = hasUnresolvedEdits
      ? ` Accept or reject the ${proposedEditsCount === 1 ? "proposed edit" : `${proposedEditsCount} proposed edits`} on the left first, then fold in.`
      : "";
    gateDescription = `${outdatedSince} Your edits and refinements live on this candidate, so choose how to bring it up to date.${unresolvedHint}`;
  } else {
    gateDescription = `${outdatedSince} Nothing has been edited on it, so it can simply be regenerated.`;
  }

  return { outdatedReason, outdatedSince, gateDescription };
}

export function formatDiscardDescription(engagedEditsCount: number): string {
  if (engagedEditsCount > 0) {
    return `This candidate has ${engagedEditsCount} edit${engagedEditsCount > 1 ? "s" : ""} that will be permanently lost if you discard it. A fresh candidate will be generated.`;
  }
  return "This candidate has refinements that will be permanently lost if you discard it. A fresh candidate will be generated.";
}

export function deriveReviewViewState({
  pendingId,
  pendingGeneratedAt,
  candStatus,
  previewLength,
  activeDraft,
  busy,
  sessionPhase,
  hasUnresolvedEdits,
  proposedEditsCount,
  edits,
  title,
}: {
  pendingId: string | undefined;
  pendingGeneratedAt: string;
  candStatus:
    | {
        id?: string;
        outdated?: boolean;
        engaged?: boolean;
        reason?: string;
        newFragmentIds?: readonly string[];
      }
    | undefined;
  previewLength: number;
  activeDraft: string | undefined;
  busy: boolean;
  sessionPhase: string;
  hasUnresolvedEdits: boolean;
  proposedEditsCount: number;
  edits: readonly { type: string }[];
  title: string;
}) {
  const isCandidateOutdated = Boolean(
    pendingId && candStatus?.id === pendingId && candStatus.outdated,
  );
  const isCandidateEngaged = Boolean(
    pendingId && candStatus?.id === pendingId && candStatus.engaged,
  );
  const engagedEditsCount = edits.filter(
    (e) => e.type === "manual" || e.type === "refinement",
  ).length;
  const pendingEmpty =
    Boolean(pendingId) && previewLength === 0 && !(activeDraft ?? "").trim();
  const approveBlocked =
    !pendingId ||
    pendingEmpty ||
    busy ||
    sessionPhase === "drafting" ||
    sessionPhase === "applying" ||
    hasUnresolvedEdits;
  const gateOpen = isCandidateOutdated && Boolean(pendingId);
  const { outdatedReason, gateDescription } = formatOutdatedCandidate({
    reason: candStatus?.reason,
    newCount: candStatus?.newFragmentIds?.length ?? 0,
    generatedAt: pendingGeneratedAt,
    engaged: isCandidateEngaged,
    hasUnresolvedEdits,
    proposedEditsCount,
  });

  return {
    isCandidateOutdated,
    isCandidateEngaged,
    engagedEditsCount,
    pendingEmpty,
    approveBlocked,
    gateOpen,
    outdatedReason,
    gateDescription,
    headerTitle: "Review update",
    headerCrumb: ["Projections", title, "Review update"],
    confirmDiscardLabel: busy ? "Refreshing…" : "Start over",
  };
}
