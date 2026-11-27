import {
  type ContextSpec,
  parseContextSpec,
  specKey,
  specToItems,
  type TimeWindow,
  timeWindowKey,
  type WindowSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import type { PreviewReflectionWindow } from "@kalaido/client/kalaidoscope/reflections";
import type { ReflectionResponse } from "@kalaido/client/kalaidoscope/types";
import { withContextItem } from "@kalaido/client/lib/mentions";
import type { ContextItem } from "@kalaido/components";
import type { ScopeHandlers } from "@kalaido/state/scope";
import {
  buildWindowSpec,
  CADENCE_DAYS,
  cadenceFromSpec,
  currentWindowSpec,
  DEFAULT_CADENCE,
  dateInputToEndTime,
  dateInputToStartTime,
  toDateInputValue,
} from "./schedule";
import type { ReflectionSeed } from "./types";

export type ReflectionRefineTab = "lens" | "schedule";

export interface ReflectionRefineState {
  activeTab: ReflectionRefineTab;
  cadence: number;
  fromDate: string;
  endDate: string;
  paused: boolean;
  context: ContextItem[];
  selectedWindowKey: string | null;
  chipsSeeded: boolean;
  reflectionId: string | null;
  input: string;
  nameInput: string;
}

export type ReflectionRefineEvent =
  | { readonly type: "setActiveTab"; readonly tab: ReflectionRefineTab }
  | { readonly type: "setCadence"; readonly cadence: number }
  | { readonly type: "setFromDate"; readonly fromDate: string }
  | { readonly type: "setEndDate"; readonly endDate: string }
  | { readonly type: "setPaused"; readonly paused: boolean }
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | { readonly type: "mentionContext"; readonly item: ContextItem }
  | { readonly type: "setSelectedWindowKey"; readonly key: string | null }
  | { readonly type: "setReflectionId"; readonly id: string | null }
  | { readonly type: "setInput"; readonly input: string }
  | { readonly type: "setNameInput"; readonly nameInput: string }
  | {
      readonly type: "seedExisting";
      readonly cadence: number;
      readonly fromDate: string;
      readonly endDate: string;
      readonly paused: boolean;
      readonly context: ContextItem[];
    };

export const REFLECTION_REFINE_HANDLERS: ScopeHandlers<
  ReflectionRefineState,
  ReflectionRefineEvent
> = {
  setActiveTab: (s, e) => {
    s.activeTab = e.tab;
  },
  setCadence: (s, e) => {
    s.cadence = e.cadence;
  },
  setFromDate: (s, e) => {
    s.fromDate = e.fromDate;
  },
  setEndDate: (s, e) => {
    s.endDate = e.endDate;
  },
  setPaused: (s, e) => {
    s.paused = e.paused;
  },
  setContext: (s, e) => {
    s.context = e.context;
  },
  mentionContext: (s, e) => {
    s.context = withContextItem(s.context, e.item);
  },
  setSelectedWindowKey: (s, e) => {
    s.selectedWindowKey = e.key;
  },
  setReflectionId: (s, e) => {
    s.reflectionId = e.id;
  },
  setInput: (s, e) => {
    s.input = e.input;
  },
  setNameInput: (s, e) => {
    s.nameInput = e.nameInput;
  },
  seedExisting: (s, e) => {
    s.cadence = e.cadence;
    s.fromDate = e.fromDate;
    s.endDate = e.endDate;
    s.paused = e.paused;
    s.context = e.context;
    s.chipsSeeded = true;
  },
};

export function createInitialReflectionRefineState(
  id: string | undefined,
): ReflectionRefineState {
  return {
    activeTab: "lens",
    cadence: DEFAULT_CADENCE,
    fromDate: toDateInputValue(new Date()),
    endDate: "",
    paused: false,
    context: [WHOLE_SCOPE_ITEM],
    selectedWindowKey: null,
    chipsSeeded: !id,
    reflectionId: id ?? null,
    input: "",
    nameInput: "",
  };
}

export function deriveExistingReflectionSeed(
  existing: ReflectionResponse,
  capturedSeed: ReflectionSeed | undefined,
  resumedContext?: ContextItem[],
) {
  const sched = cadenceFromSpec(
    currentWindowSpec(existing.window_spec_versions),
  );
  const spec = parseContextSpec(existing.current_context_spec);
  const seedMessage =
    existing.status === "proposed" ? capturedSeed?.message.trim() : "";
  const context =
    resumedContext && resumedContext.length > 0
      ? resumedContext
      : spec
        ? specToItems(spec)
        : [WHOLE_SCOPE_ITEM];
  return {
    cadence: sched.cadence,
    fromDate: sched.startTime
      ? toDateInputValue(new Date(sched.startTime))
      : "",
    endDate: sched.endTime ? toDateInputValue(new Date(sched.endTime)) : "",
    paused: Boolean(sched.paused),
    context,
    prompt: seedMessage || undefined,
  };
}

export function deriveRefineHeaderCopy({
  isNew,
  isEstablished,
  name,
  existingName,
  saving,
}: {
  isNew: boolean;
  isEstablished: boolean;
  name: string | null | undefined;
  existingName: string | undefined;
  saving: boolean;
}) {
  return {
    title: isNew ? (name ?? "New Reflection") : (existingName ?? "Reflection"),
    crumb: ["Reflections", isNew ? "New" : isEstablished ? "Update" : "Draft"],
    saveLabel: saving ? "Saving…" : "Save",
    fromNote: isEstablished
      ? "Fixed once saved. Use Backfill on the reflection to summarize further back."
      : undefined,
  };
}

export function deriveRefineWindowSpec({
  cadence,
  fromDate,
  endDate,
  paused,
  isEstablished,
}: {
  cadence: number;
  fromDate: string;
  endDate: string;
  paused: boolean;
  isEstablished: boolean;
}): WindowSpec {
  return buildWindowSpec({
    cadenceDays: CADENCE_DAYS[cadence],
    lookbackDays: CADENCE_DAYS[cadence],
    startTime: !isEstablished ? dateInputToStartTime(fromDate) : undefined,
    endTime: dateInputToEndTime(endDate),
    paused,
  });
}

/**
 * Strip upstream projection/reflection sources from a context spec so staged
 * previews and saves match the backend's fragments-and-colours-only invariant.
 */
export function reflectionContextSpec(spec: ContextSpec): ContextSpec {
  const { sourceProjectionIds: _, sourceReflectionIds: __, ...rest } = spec;
  return rest;
}

/** Canonical signature of the inputs that produce a reflection preview. */
export function previewInputKey(
  lensPrompt: string,
  contextSpec: ContextSpec,
  win: TimeWindow | undefined,
): string {
  return `${lensPrompt.trim()}\0${specKey(contextSpec)}\0${timeWindowKey(win)}`;
}

/**
 * Pick the active sample window from the latest `previewReflectionWindows`
 * result: keep the user's selected window if it still exists in the list,
 * otherwise fall back to `defaultWindowId` or the newest window.
 */
export function resolveActivePreviewWindow(
  windows: readonly PreviewReflectionWindow[],
  defaultWindowId: string | undefined,
  selectedWindowKey: string | null,
): PreviewReflectionWindow | undefined {
  if (windows.length === 0) return undefined;
  if (selectedWindowKey) {
    const match = windows.find((w) => w.key === selectedWindowKey);
    if (match) return match;
  }
  if (defaultWindowId) {
    const def = windows.find((w) => w.id === defaultWindowId);
    if (def) return def;
  }
  return windows[windows.length - 1];
}

export interface StagedBaseline {
  readonly lensPrompt: string;
  readonly scheduleKey: string;
  readonly contextKey: string;
}

export function deriveTuningViewFlags(input: {
  reflectionId: string | null;
  sessionStarted: boolean;
  effectiveLensPrompt: string;
  activeWindow: TimeWindow | undefined;
  manualPreview: { output: string; inputKey: string } | null;
  chatPreview: string;
  chatPreviewKey: string | null;
  currentInputKey: string;
  windowSpecKey: string;
  contextSpecKey: string;
  baseline: StagedBaseline;
  creating: boolean;
  saving: boolean;
  discarding: boolean;
  chatLoading: boolean;
}) {
  const started = input.reflectionId != null && input.sessionStarted;
  const displayPreview = input.manualPreview?.output ?? input.chatPreview;
  const displayedInputKey = input.manualPreview
    ? input.manualPreview.inputKey
    : input.chatPreviewKey;
  const hasLensPrompt = input.effectiveLensPrompt.trim().length > 0;
  const previewStale =
    hasLensPrompt &&
    input.activeWindow != null &&
    displayedInputKey !== input.currentInputKey;
  const busy =
    input.creating || input.saving || input.discarding || input.chatLoading;
  const lensDirty =
    input.effectiveLensPrompt.trim() !== input.baseline.lensPrompt.trim();
  const scheduleDirty =
    input.windowSpecKey !== input.baseline.scheduleKey ||
    input.contextSpecKey !== input.baseline.contextKey;
  return {
    started,
    displayPreview,
    previewStale,
    busy,
    canSave: hasLensPrompt && !busy,
    canPreview: hasLensPrompt && !busy,
    lensDirty,
    scheduleDirty,
  };
}
