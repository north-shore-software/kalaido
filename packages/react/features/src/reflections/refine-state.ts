import {
  parseContextSpec,
  specToItems,
  type TimeWindow,
  type WindowSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
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

export interface ReflectionRefineState {
  cadence: number;
  fromDate: string;
  endDate: string;
  paused: boolean;
  context: ContextItem[];
  windowOverride: TimeWindow | undefined;
  chipsSeeded: boolean;
  reflectionId: string | null;
  input: string;
  nameInput: string;
}

export type ReflectionRefineEvent =
  | { readonly type: "setCadence"; readonly cadence: number }
  | { readonly type: "setFromDate"; readonly fromDate: string }
  | { readonly type: "setEndDate"; readonly endDate: string }
  | { readonly type: "setPaused"; readonly paused: boolean }
  | { readonly type: "setContext"; readonly context: ContextItem[] }
  | { readonly type: "mentionContext"; readonly item: ContextItem }
  | {
      readonly type: "setWindowOverride";
      readonly window: TimeWindow | undefined;
    }
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
  setWindowOverride: (s, e) => {
    s.windowOverride = e.window;
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
    cadence: DEFAULT_CADENCE,
    fromDate: toDateInputValue(new Date()),
    endDate: "",
    paused: false,
    context: [WHOLE_SCOPE_ITEM],
    windowOverride: undefined,
    chipsSeeded: !id,
    reflectionId: id ?? null,
    input: "",
    nameInput: "",
  };
}

export function deriveExistingReflectionSeed(
  existing: ReflectionResponse,
  capturedSeed: ReflectionSeed | undefined,
) {
  const sched = cadenceFromSpec(
    currentWindowSpec(existing.window_spec_versions),
  );
  const spec = parseContextSpec(existing.current_context_spec);
  const seedMessage =
    existing.status === "proposed" ? capturedSeed?.message.trim() : "";
  return {
    cadence: sched.cadence,
    fromDate: sched.startTime
      ? toDateInputValue(new Date(sched.startTime))
      : "",
    endDate: sched.endTime ? toDateInputValue(new Date(sched.endTime)) : "",
    paused: Boolean(sched.paused),
    context: spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM],
    prompt: seedMessage || undefined,
  };
}

export function deriveRefineHeaderCopy({
  isNew,
  name,
  existingName,
  committing,
}: {
  isNew: boolean;
  name: string | null | undefined;
  existingName: string | undefined;
  committing: boolean;
}) {
  return {
    title: isNew ? (name ?? "New Reflection") : (existingName ?? "Reflection"),
    crumb: ["Reflections", isNew ? "New" : "Refine"],
    doneLabel: committing ? "Committing…" : "Done",
    fromNote: isNew
      ? undefined
      : "Fixed once created. Use Backfill on the reflection to summarize further back.",
  };
}

export function deriveRefineWindowSpec({
  cadence,
  fromDate,
  endDate,
  paused,
  isNew,
}: {
  cadence: number;
  fromDate: string;
  endDate: string;
  paused: boolean;
  isNew: boolean;
}): WindowSpec {
  return buildWindowSpec({
    cadenceDays: CADENCE_DAYS[cadence],
    lookbackDays: CADENCE_DAYS[cadence],
    startTime: isNew ? dateInputToStartTime(fromDate) : undefined,
    endTime: dateInputToEndTime(endDate),
    paused,
  });
}
