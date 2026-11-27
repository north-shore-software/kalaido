export function deriveReviewViewState({
  pendingId,
  previewLength,
  activeDraft,
  busy,
  sessionPhase,
  hasUnresolvedEdits,
  title,
}: {
  pendingId: string | undefined;
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

  return {
    pendingEmpty,
    approveBlocked,
    headerTitle: title,
    headerCrumb: ["Projections", title, "Draft"],
  };
}
