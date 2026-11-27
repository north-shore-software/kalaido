import { parseActiveWindow } from "@kalaido/client/kalaidoscope/chat";
import { type ContextItem, PageHeader } from "@kalaido/components";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useEffect, useRef, useState } from "react";
import { LivePreviewPane } from "./components/live-preview-pane";
import { RefineConfigPanel } from "./components/refine-config-panel";
import { ReflectionLensDialog } from "./components/reflection-lens-dialog";
import { ReflectionRefineMiddlePane } from "./components/reflection-refine-middle-pane";
import { SchedulePill } from "./components/schedule-controls";
import { StandingLensCard } from "./components/standing-lens-card";
import { WindowSelect } from "./components/window-select";
import { usePersistSchedule } from "./hooks/use-persist-schedule";
import { useReflectionRefineActions } from "./hooks/use-reflection-refine-actions";
import {
  createInitialReflectionRefineState,
  deriveExistingReflectionSeed,
  deriveRefineHeaderCopy,
  deriveRefineWindowSpec,
  REFLECTION_REFINE_HANDLERS,
} from "./refine-state";
import { CADENCE_WIN, CADENCES } from "./schedule";
import type { ReflectionSeed } from "./types";

export interface ReflectionRefineScreenProps {
  id?: string;
  seed?: ReflectionSeed;
  onCancel: (id?: string) => void;
  onCommitSuccess: (id: string) => void;
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
  const [lensDialogOpen, setLensDialogOpen] = useState(false);
  const [directLensOverride, setDirectLensOverride] = useState<string | null>(
    null,
  );

  const existingQuery = useLiveCollection("reflection", {
    filter: id ? `id="${id}"` : undefined,
    enabled: !isNew,
  });
  const existing = existingQuery.records[0];

  const scope = useScope({
    initial: () => createInitialReflectionRefineState(id),
    handlers: REFLECTION_REFINE_HANDLERS,
  });
  const state = useScopeState(scope);

  const session = useRefineSession({ target: "reflection" });
  const { name, adopt, rename } = useDraftName({
    target: "reflection",
    entityId: state.reflectionId,
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
      endDate: derived.endDate,
      paused: derived.paused,
      context: derived.context,
    });
    void session.start({ parentId: existing.id, prompt: derived.prompt });
  }, [isNew, existing, capturedSeed, session.start, scope]);

  const started = state.reflectionId != null && session.started;
  const canCommit = started && session.previewReady && !session.committing;
  const windowSpec = deriveRefineWindowSpec({
    cadence: state.cadence,
    fromDate: state.fromDate,
    endDate: state.endDate,
    paused: state.paused,
    isNew,
  });
  usePersistSchedule({
    reflectionId: state.reflectionId,
    spec: windowSpec,
    ready: state.chipsSeeded && state.reflectionId != null,
  });

  const activeWindow =
    state.windowOverride ?? parseActiveWindow(session.messages) ?? undefined;

  const { creating, startReflection, finish, commitTitle } =
    useReflectionRefineActions({
      isNew,
      reflectionId: state.reflectionId,
      session,
      windowSpec,
      input: state.input,
      nameInput: state.nameInput,
      context: state.context as ContextItem[],
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
  const displayLens = directLensOverride ?? session.latestLens;

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
              cadence={state.cadence}
              onCadenceChange={(next) =>
                void scope.dispatch({ type: "setCadence", cadence: next })
              }
              fromDate={state.fromDate}
              onFromDateChange={(next) =>
                void scope.dispatch({ type: "setFromDate", fromDate: next })
              }
              fromDisabled={!isNew || started}
              fromNote={headerCopy.fromNote}
              endDate={state.endDate}
              onEndDateChange={(next) =>
                void scope.dispatch({ type: "setEndDate", endDate: next })
              }
              paused={state.paused}
              onPausedChange={(next) =>
                void scope.dispatch({ type: "setPaused", paused: next })
              }
            />
            <SchedulePill
              freq={state.paused ? "Paused" : CADENCES[state.cadence]}
              win={`${CADENCE_WIN[state.cadence]} · auto-approved`}
            />
            <StandingLensCard
              lensPrompt={displayLens}
              canEdit={state.reflectionId != null}
              onEdit={() => setLensDialogOpen(true)}
            />
          </div>

          <ReflectionRefineMiddlePane
            started={started}
            isNew={isNew}
            session={session}
            context={state.context as ContextItem[]}
            activeWindow={activeWindow}
            input={state.input}
            nameInput={state.nameInput}
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
              started && state.reflectionId ? (
                <WindowSelect
                  compact
                  reflectionId={state.reflectionId}
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

      {state.reflectionId && (
        <ReflectionLensDialog
          open={lensDialogOpen}
          onOpenChange={setLensDialogOpen}
          reflectionId={state.reflectionId}
          fallbackPrompt={session.latestLens}
          onSaved={(savedPrompt) => setDirectLensOverride(savedPrompt)}
        />
      )}
    </>
  );
}
