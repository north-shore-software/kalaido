import { type ContextItem, PageHeader } from "@kalaido/components";
import { ConfirmDialog } from "@kalaido/primitives/kalaido";
import { PageCard } from "@kalaido/primitives/layout/page-primitives";
import { Button } from "@kalaido/primitives/shadcn/button";
import { LivePreviewPane } from "./components/live-preview-pane";
import { ReflectionRefineMiddlePane } from "./components/reflection-refine-middle-pane";
import { useReflectionTuning } from "./hooks/use-reflection-tuning";
import type { ReflectionSeed } from "./types";

export interface ReflectionRefineScreenProps {
  id?: string;
  seed?: ReflectionSeed;
  onCancel: (id?: string) => void;
  onCommitSuccess: (id: string) => void;
  onDiscardSuccess?: () => void;
}

/**
 * 2-tab (`Lens` | `Schedule & Sources`) reflection tuning workspace beside one
 * persistent Preview pane. Stages Schedule, Sources, and Standing Lens locally
 * until atomic Save. Resumes unfinished drafts for never-saved reflections;
 * starts a fresh tuning session for established reflections.
 */
export function ReflectionRefineScreen({
  id,
  seed,
  onCancel,
  onCommitSuccess,
  onDiscardSuccess,
}: ReflectionRefineScreenProps) {
  const {
    isNew,
    isEstablished,
    started,
    scope,
    state,
    session,
    previewWindows,
    activeWindow,
    effectiveLensPrompt,
    setDirectLens,
    displayPreview,
    previewStale,
    busy,
    canSave,
    canPreview,
    lensDirty,
    scheduleDirty,
    headerCopy,
    discardConfirmOpen,
    setDiscardConfirmOpen,
    handleSecondaryAction,
    actions,
  } = useReflectionTuning({
    id,
    seed,
    onCancel,
    onCommitSuccess,
    onDiscardSuccess,
  });

  return (
    <>
      <PageHeader
        title={headerCopy.title}
        crumb={headerCopy.crumb}
        onTitleCommit={started ? actions.commitTitle : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              disabled={actions.saving || actions.discarding}
              onClick={handleSecondaryAction}
            >
              {isEstablished ? "Cancel" : "Discard"}
            </Button>
            <Button
              variant="commit"
              disabled={!canSave}
              onClick={() => void actions.save()}
            >
              {headerCopy.saveLabel}
            </Button>
          </>
        }
      />
      <PageCard>
        <div className="flex min-h-0 flex-1">
          <ReflectionRefineMiddlePane
            activeTab={state.activeTab}
            onTabChange={(tab) =>
              void scope.dispatch({ type: "setActiveTab", tab })
            }
            lensDirty={lensDirty}
            scheduleDirty={scheduleDirty}
            started={started}
            isNew={isNew}
            isEstablished={isEstablished}
            fromNote={headerCopy.fromNote}
            session={session}
            lensPrompt={effectiveLensPrompt}
            onLensPromptChange={setDirectLens}
            cadence={state.cadence}
            onCadenceChange={(cadence) =>
              void scope.dispatch({ type: "setCadence", cadence })
            }
            fromDate={state.fromDate}
            onFromDateChange={(fromDate) =>
              void scope.dispatch({ type: "setFromDate", fromDate })
            }
            endDate={state.endDate}
            onEndDateChange={(endDate) =>
              void scope.dispatch({ type: "setEndDate", endDate })
            }
            paused={state.paused}
            onPausedChange={(paused) =>
              void scope.dispatch({ type: "setPaused", paused })
            }
            context={state.context as ContextItem[]}
            activeWindow={activeWindow}
            input={state.input}
            nameInput={state.nameInput}
            creating={actions.creating}
            busy={busy}
            onInputChange={(input) =>
              void scope.dispatch({ type: "setInput", input })
            }
            onNameInputChange={(nameInput) =>
              void scope.dispatch({ type: "setNameInput", nameInput })
            }
            onContextChange={(context) =>
              void scope.dispatch({ type: "setContext", context })
            }
            onMention={(item) =>
              void scope.dispatch({ type: "mentionContext", item })
            }
            onStartReflection={() => void actions.startReflection()}
          />

          <LivePreviewPane
            preview={displayPreview}
            phase={session.phase}
            previewWindows={previewWindows.windows}
            activeWindow={activeWindow}
            onSelectWindow={(win) =>
              void scope.dispatch({
                type: "setSelectedWindowKey",
                key: win.key,
              })
            }
            previewStale={previewStale}
            previewLoading={actions.previewLoading}
            windowsLoading={previewWindows.loading}
            canPreview={canPreview}
            onRunPreview={() => void actions.runManualPreview()}
          />
        </div>
      </PageCard>

      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title="Discard reflection draft?"
        description="This reflection has never been saved. Discarding will permanently remove this unfinished draft and its conversation."
        confirmLabel={actions.discarding ? "Discarding…" : "Discard draft"}
        variant="destructive"
        busy={actions.discarding}
        onConfirm={() => void actions.discardDraft()}
      />
    </>
  );
}
