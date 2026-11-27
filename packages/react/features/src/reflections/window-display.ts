import {
  isReflectionSentinelModel,
  REFLECTION_MODEL_EMPTY,
  REFLECTION_MODEL_MANUAL,
} from "@kalaido/client/kalaidoscope/reflections";
import type { ReflectionSnapshotResponse } from "@kalaido/client/kalaidoscope/types";
import { formatWindowRange } from "@kalaido/client/lib/datetime";
import type { TimelineItem } from "@kalaido/primitives/kalaido";
import type { SeriesWindow } from "./hooks/use-reflection-series";

export function windowLabel(w: SeriesWindow): string {
  return w.start && w.end ? formatWindowRange(w.start, w.end) : "All time";
}

export function windowState(w: SeriesWindow): string {
  if (w.generating) return "generating…";
  if (!w.snapshot) return "no summary yet";
  if (w.isEmptyWindow) return "no fragments";
  if (w.olderLens) return "older lens";
  if (w.stale) return "new fragments";
  if (w.isManualEdit) return "edited";
  return "summary";
}

export function refreshAllButtonLabel(
  busy: string | null,
  needsWork: number,
): string {
  if (busy === "all") return "Refreshing…";
  return needsWork > 0 ? `Refresh (${needsWork})` : "Refresh";
}

export function windowActionLabel(
  busy: string | null,
  w: SeriesWindow,
): string {
  if (busy === w.id) return "Generating…";
  return w.snapshot ? "Regenerate" : "Generate";
}

export function refreshAllSuccessMessage(count: number): string {
  if (count === 0) return "Everything is up to date";
  return `Regenerated ${count} ${count === 1 ? "summary" : "summaries"}`;
}

export function snapshotOriginLabel(
  snap: ReflectionSnapshotResponse | undefined,
): string {
  const model = snap?.generated_by_model;
  if (model === REFLECTION_MODEL_EMPTY) return "Empty window";
  if (model === REFLECTION_MODEL_MANUAL) return "Edited";
  return "Generated";
}

/**
 * Returns the real LLM model name for display, or undefined for non-LLM
 * sentinel origins (`"empty"`, `"manual"`) so sentinels are never rendered as
 * LLM model identifiers.
 */
export function snapshotDisplayModel(
  snap: ReflectionSnapshotResponse | undefined,
): string | undefined {
  const model = snap?.generated_by_model?.trim();
  if (!model || isReflectionSentinelModel(model)) return undefined;
  return model;
}

export function revisionOptionLabel(
  snap: ReflectionSnapshotResponse,
  index: number,
  total: number,
): string {
  const revNum = snap.approval_sequence_number ?? total - index;
  const origin = snapshotOriginLabel(snap);
  const latestSuffix = index === 0 ? " (Latest)" : "";
  return `Rev ${revNum} · ${origin}${latestSuffix}`;
}

export function buildSeriesTimeline(
  windows: readonly SeriesWindow[],
  selectedId: string | undefined,
  onSelectWindow: (id: string) => void,
): TimelineItem[] {
  return windows.map((w) => ({
    id: w.id,
    label: windowLabel(w),
    note: windowState(w),
    current: !!w.snapshot && !w.isEmptyWindow && !w.olderLens && !w.stale,
    pending: w.generating || !w.snapshot,
    active: selectedId === w.id,
    onClick: () => onSelectWindow(w.id),
  }));
}

export interface ViewedRevisionState {
  viewed: ReflectionSnapshotResponse | undefined;
  isLatest: boolean;
  isEmpty: boolean;
  isManual: boolean;
  displayModel: string | undefined;
  originLabel: string;
  content: string | undefined;
  showOlderLens: boolean;
  showNewFragments: boolean;
}

export function deriveViewedRevision(
  selected: SeriesWindow,
  selectedRevisionId: string | null,
): ViewedRevisionState {
  const viewed =
    selected.revisions.find((r) => r.id === selectedRevisionId) ??
    selected.snapshot;
  const isLatest = !viewed || viewed.id === selected.snapshot?.id;
  const viewedModel = viewed?.generated_by_model;
  const isEmpty = viewedModel === REFLECTION_MODEL_EMPTY;
  const isManual = viewedModel === REFLECTION_MODEL_MANUAL;
  const content =
    typeof viewed?.output === "string" ? viewed.output : undefined;
  return {
    viewed,
    isLatest,
    isEmpty,
    isManual,
    displayModel: snapshotDisplayModel(viewed),
    originLabel: snapshotOriginLabel(viewed),
    content,
    showOlderLens: isLatest && selected.olderLens,
    showNewFragments:
      isLatest && Boolean(selected.stale) && !selected.olderLens,
  };
}
