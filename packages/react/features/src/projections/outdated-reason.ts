export function deriveReviewViewState({
  pendingId,
  snapshotId,
  isGeneratingClaim,
  hasRedirect,
  isNeverSaved,
  discarding,
  newSinceCandidate,
  previewLength,
  activeDraft,
  busy,
  sessionPhase,
  hasUnresolvedEdits,
  title,
}: {
  pendingId: string | undefined;
  snapshotId: string;
  isGeneratingClaim: boolean;
  hasRedirect: boolean;
  isNeverSaved: boolean;
  discarding: boolean;
  newSinceCandidate: number;
  previewLength: number;
  activeDraft: string | undefined;
  busy: boolean;
  sessionPhase: string;
  hasUnresolvedEdits: boolean;
  title: string;
}) {
  const pendingEmpty =
    Boolean(pendingId) && previewLength === 0 && !(activeDraft ?? "").trim();
  const approveBlocked =
    !pendingId ||
    pendingEmpty ||
    busy ||
    sessionPhase === "drafting" ||
    sessionPhase === "applying" ||
    hasUnresolvedEdits;
  const shouldRedirectToPending =
    Boolean(pendingId) &&
    pendingId !== snapshotId &&
    !isGeneratingClaim &&
    hasRedirect;

  const newSinceBanner =
    newSinceCandidate > 0
      ? `${newSinceCandidate} new ${newSinceCandidate === 1 ? "fragment" : "fragments"} arrived since this draft opened — save when ready, then update to include ${newSinceCandidate === 1 ? "it" : "them"}.`
      : null;

  return {
    pendingEmpty,
    approveBlocked,
    shouldRedirectToPending,
    newSinceBanner,
    discardTitle: isNeverSaved
      ? "Discard this unsaved projection?"
      : "Discard this draft?",
    discardDescription: isNeverSaved
      ? "This projection hasn't been saved yet. Discarding will remove it."
      : "Your saved snapshot will stay unchanged, and this draft session will close permanently.",
    discardConfirmLabel: discarding ? "Discarding…" : "Discard",
    headerTitle: title,
    headerCrumb: ["Projections", title, "Draft"],
  };
}
