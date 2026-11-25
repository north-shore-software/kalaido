import {
  parseActiveWindow,
  parseContextSpec,
  specToItems,
  type TimeWindow,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import type { ReflectionResponse } from "@kalaido/client/kalaidoscope/types";
import { withContextItem } from "@kalaido/client/lib/mentions";
import { type ContextItem, PageHeader } from "@kalaido/components";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { useEffect, useRef, useState } from "react";
import { LivePreviewPane } from "./components/live-preview-pane";
import { RefineConfigPanel } from "./components/refine-config-panel";
import { ReflectionRefineMiddlePane } from "./components/reflection-refine-middle-pane";
import { SchedulePill } from "./components/schedule-controls";
import { WindowSelect } from "./components/window-select";
import { usePersistSchedule } from "./hooks/use-persist-schedule";
import { useReflectionRefineActions } from "./hooks/use-reflection-refine-actions";
import {
  buildWindowSpec,
  CADENCE_DAYS,
  CADENCE_WIN,
  CADENCES,
  cadenceFromSpec,
  currentWindowSpec,
  DEFAULT_CADENCE,
  dateInputToStartTime,
  toDateInputValue,
} from "./schedule";
import type { ReflectionSeed } from "./types";

interface ReflectionRefineState {
  cadence: number;
  fromDate: string;
  context: ContextItem[];
  windowOverride: TimeWindow | undefined;
  chipsSeeded: boolean;
  reflectionId: string | null;
  input: string;
  nameInput: string;
}

type ReflectionRefineEvent =
  | { readonly type: "setCadence"; readonly cadence: number }
  | { readonly type: "setFromDate"; readonly fromDate: string }
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
      readonly context: ContextItem[];
    };

export interface ReflectionRefineScreenProps {
  id?: string;
  seed?: ReflectionSeed;
  onCancel: (id?: string) => void;
  onCommitSuccess: (id: string) => void;
}

const REFLECTION_REFINE_HANDLERS: ScopeHandlers<
  ReflectionRefineState,
  ReflectionRefineEvent
> = {
  setCadence: (s, e) => {
    s.cadence = e.cadence;
  },
  setFromDate: (s, e) => {
    s.fromDate = e.fromDate;
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
    s.context = e.context;
    s.chipsSeeded = true;
  },
};

function deriveExistingReflectionSeed(
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
    context: spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM],
    prompt: seedMessage || undefined,
  };
}

function deriveRefineHeaderCopy({
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

/**
 * The one screen where a reflection's lens is written: creating a reflection
 * (`/reflections/new`) and refining an existing one (`/reflections/:id/refine`)
 * are the same activity.
 */
export function ReflectionRefineScreen({
  id,
  seed,
  onCancel,
  onCommitSuccess,
}: ReflectionRefineScreenProps) {
  const isNew = !id;
  const [capturedSeed] = useState(() => seed);

  const existingQuery = useLiveCollection("reflection", {
    filter: id ? `id="${id}"` : undefined,
    enabled: !isNew,
  });
  const existing = existingQuery.records[0];

  const scope = useScope({
    initial: (): ReflectionRefineState => ({
      cadence: DEFAULT_CADENCE,
      fromDate: toDateInputValue(new Date()),
      context: [WHOLE_SCOPE_ITEM],
      windowOverride: undefined,
      chipsSeeded: isNew,
      reflectionId: id ?? null,
      input: "",
      nameInput: "",
    }),
    handlers: REFLECTION_REFINE_HANDLERS,
  });

  const {
    cadence,
    fromDate,
    context,
    windowOverride,
    chipsSeeded,
    reflectionId,
    input,
    nameInput,
  } = useScopeState(scope);

  const session = useRefineSession({ target: "reflection" });
  const { name, adopt, rename } = useDraftName({
    target: "reflection",
    entityId: reflectionId,
    suggestedName: session.suggestedName,
  });

  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (isNew || !existing || seededFor.current === existing.id) return;
    seededFor.current = existing.id;
    const derived = deriveExistingReflectionSeed(existing, capturedSeed);
    void scope.dispatch({
      type: "seedExisting",
      cadence: derived.cadence,
      fromDate: derived.fromDate,
      context: derived.context,
    });
    void session.start({ parentId: existing.id, prompt: derived.prompt });
  }, [isNew, existing, capturedSeed, session.start, scope]);

  const started = reflectionId != null && session.started;
  const canCommit = started && session.previewReady && !session.committing;
  const windowSpec = buildWindowSpec({
    cadenceDays: CADENCE_DAYS[cadence],
    lookbackDays: CADENCE_DAYS[cadence],
    startTime: isNew ? dateInputToStartTime(fromDate) : undefined,
  });
  usePersistSchedule({
    reflectionId,
    spec: windowSpec,
    ready: chipsSeeded && reflectionId != null,
  });

  const activeWindow =
    windowOverride ?? parseActiveWindow(session.messages) ?? undefined;

  const { creating, startReflection, finish, commitTitle } =
    useReflectionRefineActions({
      isNew,
      reflectionId,
      session,
      windowSpec,
      input,
      nameInput,
      context: context as ContextItem[],
      canCommit,
      adopt,
      rename,
      onReflectionCreated: (nextId) =>
        void scope.dispatch({ type: "setReflectionId", id: nextId }),
      onCommitSuccess,
    });

  const headerCopy = deriveRefineHeaderCopy({
    isNew,
    name,
    existingName: existing?.name,
    committing: session.committing,
  });

  return (
    <>
      <PageHeader
        title={headerCopy.title}
        crumb={headerCopy.crumb}
        onTitleCommit={started ? commitTitle : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => onCancel(id)}>
              Cancel
            </Button>
            <Button
              variant="commit"
              disabled={!canCommit}
              onClick={() => void finish()}
            >
              {headerCopy.doneLabel}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[322px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line p-4">
            <RefineConfigPanel
              cadence={cadence}
              onCadenceChange={(next) =>
                void scope.dispatch({ type: "setCadence", cadence: next })
              }
              fromDate={fromDate}
              onFromDateChange={(next) =>
                void scope.dispatch({ type: "setFromDate", fromDate: next })
              }
              fromDisabled={!isNew || started}
              fromNote={headerCopy.fromNote}
            />
            <SchedulePill
              freq={CADENCES[cadence]}
              win={`${CADENCE_WIN[cadence]} · auto-approved`}
            />
          </div>

          <ReflectionRefineMiddlePane
            started={started}
            isNew={isNew}
            session={session}
            context={context as ContextItem[]}
            activeWindow={activeWindow}
            input={input}
            nameInput={nameInput}
            creating={creating}
            onInputChange={(next) =>
              void scope.dispatch({ type: "setInput", input: next })
            }
            onNameInputChange={(next) =>
              void scope.dispatch({ type: "setNameInput", nameInput: next })
            }
            onContextChange={(next) =>
              void scope.dispatch({ type: "setContext", context: next })
            }
            onMention={(item) =>
              void scope.dispatch({ type: "mentionContext", item })
            }
            onStartReflection={() => void startReflection()}
          />

          <LivePreviewPane
            started={started}
            preview={session.preview}
            phase={session.phase}
            header={
              started && reflectionId ? (
                <WindowSelect
                  compact
                  reflectionId={reflectionId}
                  active={activeWindow}
                  onChange={(win) => {
                    void scope.dispatch({
                      type: "setWindowOverride",
                      window: win,
                    });
                    session.chat.applyTimeWindow(win);
                  }}
                />
              ) : undefined
            }
          />
        </div>
      </PageCard>
    </>
  );
}
