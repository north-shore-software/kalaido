import {
  parseActiveWindow,
  parseContextSpec,
  specToItems,
  type TimeWindow,
  type WindowSpec,
} from "@kalaido/client/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@kalaido/client/kalaidoscope/context-items";
import {
  createReflection,
  updateReflection,
} from "@kalaido/client/kalaidoscope/reflections";
import { withContextItem } from "@kalaido/client/lib/mentions";
import { deriveName } from "@kalaido/client/lib/naming";
import {
  ContextBar,
  type ContextItem,
  PageHeader,
  RefineChatPanel,
  RefineComposer,
} from "@kalaido/components";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Input } from "@kalaido/primitives/shadcn/input";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LivePreviewPane } from "./components/live-preview-pane";
import { RefineConfigPanel } from "./components/refine-config-panel";
import { SchedulePill } from "./components/schedule-controls";
import { WindowSelect } from "./components/window-select";
import { usePersistSchedule } from "./hooks/use-persist-schedule";
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

/**
 * The one screen where a reflection's lens is written: creating a reflection
 * (`/reflections/new`) and refining an existing one (`/reflections/:id/refine`)
 * are the same activity. Schedule on the left, the lens chat in the middle,
 * the preview on the right with the window it is generated against — changing
 * that window regenerates the preview and nothing else. Done installs the lens
 * only: the series then regenerates its windows under it.
 */
export function ReflectionRefineScreen({
  id,
  seed,
  onCancel,
  onCommitSuccess,
}: ReflectionRefineScreenProps) {
  const isNew = !id;
  // Captured once: navigating away and back must not re-send the message.
  const [capturedSeed] = useState(() => seed);

  const existingQuery = useLiveCollection("reflection", {
    filter: id ? `id="${id}"` : undefined,
    enabled: !isNew,
  });
  const existing = existingQuery.records[0];

  const handlers: ScopeHandlers<ReflectionRefineState, ReflectionRefineEvent> =
    {
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
  const scope = useScope({
    initial: (): ReflectionRefineState => ({
      cadence: DEFAULT_CADENCE,
      // "Starting from": a local calendar date, the grid origin — where the first
      // period begins and the phase it recurs on. In the past = backfill to it.
      fromDate: toDateInputValue(new Date()),
      context: [WHOLE_SCOPE_ITEM],
      windowOverride: undefined,
      chipsSeeded: isNew,
      reflectionId: id ?? null,
      input: "",
      nameInput: "",
    }),
    handlers,
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

  const createWrite = useExternalWrite<
    { initialName: string; windowSpec: WindowSpec },
    { readonly id: string }
  >({
    execute: ({ initialName, windowSpec: ws }) =>
      createReflection(initialName, ws),
    concurrency: "ignore",
  });

  const renameWrite = useExternalWrite<{ id: string; next: string }, void>({
    execute: async ({ id: targetId, next }) =>
      (await updateReflection(targetId, { name: next })).map(() => undefined),
    concurrency: "ignore",
  });

  // Existing reflection: seed chips and context from the record, and open the
  // session at once — the server seeds it with the current lens, so the chat
  // and preview start from what exists. A proposal has no lens yet: its
  // opening message goes as the first turn instead, and the drafting turn
  // writes the lens.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (isNew || !existing || seededFor.current === existing.id) return;
    seededFor.current = existing.id;
    const sched = cadenceFromSpec(
      currentWindowSpec(existing.window_spec_versions),
    );
    const spec = parseContextSpec(existing.current_context_spec);
    void scope.dispatch({
      type: "seedExisting",
      cadence: sched.cadence,
      fromDate: sched.startTime
        ? toDateInputValue(new Date(sched.startTime))
        : "",
      context: spec ? specToItems(spec) : [WHOLE_SCOPE_ITEM],
    });
    const seedMessage =
      existing.status === "proposed" ? capturedSeed?.message.trim() : "";
    void session.start({
      parentId: existing.id,
      prompt: seedMessage || undefined,
    });
  }, [isNew, existing, capturedSeed, session.start, scope]);

  const started = reflectionId != null && session.started;
  const creating = createWrite.isPending || session.creating;
  const preview = session.preview;
  const canCommit = started && session.previewReady && !session.committing;

  // An existing reflection's origin stays server-side: PATCHes omit it.
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

  // The window the preview is generated against: the server's seed (the
  // current window, or the trailing "as of now" window before the first grid
  // point) until the selector moves it.
  const activeWindow =
    windowOverride ?? parseActiveWindow(session.messages) ?? undefined;

  // New reflection: the first message creates it (with its schedule) and
  // opens the session. There is no lens yet; it is born on commit.
  async function startReflection() {
    const text = input.trim();
    if (!text || creating) return;

    const typedName = nameInput.trim();
    const initialName = typedName || deriveName(text, "Untitled reflection");
    const created = await createWrite.run({ initialName, windowSpec });
    if (created.status === "ignored") return;
    if (created.status === "error") {
      toast.error("Failed to create reflection", {
        description: created.error.message,
      });
      return;
    }
    const newReflectionId = created.id;

    const ok = await session.start({
      parentId: newReflectionId,
      prompt: text,
      context: context as ContextItem[],
    });
    if (ok) {
      adopt(initialName, !!typedName);
      void scope.dispatch({ type: "setReflectionId", id: newReflectionId });
    }
  }

  async function finish() {
    if (!reflectionId || !canCommit) return;
    if (await session.commit(reflectionId)) {
      onCommitSuccess(reflectionId);
    }
  }

  function commitTitle(next: string) {
    if (isNew) {
      rename(next);
      return;
    }
    if (!reflectionId) return;
    void renameWrite.run({ id: reflectionId, next }).then((outcome) => {
      if (outcome.status === "error") {
        toast.error("Failed to rename", { description: outcome.error.message });
      }
    });
  }

  const title = isNew
    ? (name ?? "New Reflection")
    : (existing?.name ?? "Reflection");

  return (
    <>
      <PageHeader
        title={title}
        crumb={["Reflections", isNew ? "New" : "Refine"]}
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
              {session.committing ? "Committing…" : "Done"}
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
              fromNote={
                isNew
                  ? undefined
                  : "Fixed once created. Use Backfill on the reflection to summarize further back."
              }
            />

            <SchedulePill
              freq={CADENCES[cadence]}
              win={`${CADENCE_WIN[cadence]} · auto-approved`}
            />
          </div>

          <div className="flex min-w-0 flex-[1.05] flex-col border-r border-line">
            {started ? (
              <RefineChatPanel
                session={session}
                title={isNew ? "Define the summary" : "Refine the lens"}
                context={context as ContextItem[]}
                onMention={(item) =>
                  void scope.dispatch({ type: "mentionContext", item })
                }
                onContextChange={(next) =>
                  void scope.dispatch({ type: "setContext", context: next })
                }
                entity="reflection"
                timeWindow={activeWindow}
                placeholder={
                  isNew
                    ? undefined
                    : "‘group by project and lead with blockers’…"
                }
              />
            ) : isNew ? (
              <RefineComposer
                title="Define the summary"
                helperText="Describe the summary you want. Your first message creates the reflection and starts generating a draft."
                helperTextClassName="max-w-[70%]"
                value={input}
                onChange={(next) =>
                  void scope.dispatch({ type: "setInput", input: next })
                }
                placeholder="‘a tight weekly work-snippet of what shipped’…"
                disabled={creating}
                onSubmit={() => void startReflection()}
                onMention={(item) =>
                  void scope.dispatch({ type: "mentionContext", item })
                }
                nameField={
                  <div className="shrink-0 px-4 pb-3">
                    <Input
                      value={nameInput}
                      onChange={(e) =>
                        void scope.dispatch({
                          type: "setNameInput",
                          nameInput: e.target.value,
                        })
                      }
                      placeholder="Name (optional — Kalaido will suggest one)"
                      aria-label="Reflection name"
                      disabled={creating}
                    />
                  </div>
                }
                beforeInput={
                  <ContextBar
                    items={context as ContextItem[]}
                    onChange={(next) =>
                      void scope.dispatch({ type: "setContext", context: next })
                    }
                    entity="reflection"
                    timeWindow={activeWindow}
                  />
                }
              />
            ) : (
              <RefineComposer preparing />
            )}
          </div>

          <LivePreviewPane
            started={started}
            preview={preview}
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
