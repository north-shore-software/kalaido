import type { SnapshotEdit } from "@kalaido/client/kalaidoscope/projections";

export type EditNoticeKind = "hand_edit" | "refine_target" | "triage";

export interface SystemEditNotice {
  kind: EditNoticeKind;
  editId?: string;
  sequence?: number;
  status?: "approved" | "rejected" | "proposed";
  passage?: string;
  before?: string;
  after?: string;
  rawText?: string;
}

export type EditNoticeIconKind =
  | "hand_edit"
  | "refine_target"
  | "approved"
  | "rejected"
  | "proposed"
  | "none";

export interface DescribedEditNotice {
  label: string;
  iconKind: EditNoticeIconKind;
  canUndo: boolean;
  isUndoable: boolean;
  undoReason: string | undefined;
  triageText: string;
  fallbackRawText: string | undefined;
}

function describeNoticeLabel(
  notice: SystemEditNotice,
  isUndone: boolean,
): string {
  if (notice.kind === "hand_edit") {
    return notice.sequence
      ? `Hand edit #${notice.sequence} applied`
      : "Hand edit applied";
  }
  if (notice.kind === "refine_target") {
    return "Refine target selected";
  }
  if (notice.status === "proposed") {
    return notice.sequence ? `Edit #${notice.sequence} undone` : "Edit undone";
  }
  if (isUndone) {
    return notice.status === "approved"
      ? `Edit #${notice.sequence} accepted (undone)`
      : `Edit #${notice.sequence} rejected (undone)`;
  }
  return notice.status === "approved"
    ? `Edit #${notice.sequence} accepted`
    : `Edit #${notice.sequence} rejected`;
}

function describeIconKind(notice: SystemEditNotice): EditNoticeIconKind {
  if (notice.kind === "hand_edit") return "hand_edit";
  if (notice.kind === "refine_target") return "refine_target";
  if (notice.status === "approved") return "approved";
  if (notice.status === "rejected") return "rejected";
  if (notice.status === "proposed") return "proposed";
  return "none";
}

function describeTriageText(notice: SystemEditNotice): string {
  if (notice.rawText) return notice.rawText;
  if (notice.status === "approved") return "The edit was approved.";
  if (notice.status === "rejected") return "The edit was rejected.";
  return "The edit decision was undone.";
}

export function describeEditNotice(
  notice: SystemEditNotice,
  liveEdit?: SnapshotEdit,
): DescribedEditNotice {
  const isTriage = notice.kind === "triage";
  const isUndone =
    isTriage &&
    (notice.status === "proposed" || liveEdit?.status === "proposed");
  const canUndo =
    isTriage &&
    !isUndone &&
    (notice.status === "approved" || notice.status === "rejected");
  const isUndoable = canUndo && liveEdit?.undoable === true;
  const undoReason = canUndo
    ? liveEdit?.undoReason || "another edit was made on top"
    : undefined;

  const fallbackRawText =
    notice.kind === "hand_edit" && !notice.before && !notice.after
      ? notice.rawText
      : notice.kind === "refine_target" && !notice.passage
        ? notice.rawText
        : undefined;

  return {
    label: describeNoticeLabel(notice, isUndone),
    iconKind: describeIconKind(notice),
    canUndo,
    isUndoable,
    undoReason,
    triageText: describeTriageText(notice),
    fallbackRawText,
  };
}
