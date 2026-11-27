import { itemsToSpec, specKey } from "@kalaido/client/kalaidoscope/chat";
import { getReflectionLens } from "@kalaido/client/kalaidoscope/reflections";
import type { ContextItem } from "@kalaido/components";
import { useDraftName } from "@kalaido/hooks/use-draft-name";
import { useLiveCollection } from "@kalaido/hooks/use-live-collection";
import { useRefineSession } from "@kalaido/hooks/use-refine-session";
import { useScope, useScopeState } from "@kalaido/state/scope";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createInitialReflectionRefineState,
  deriveExistingReflectionSeed,
  deriveRefineHeaderCopy,
  deriveRefineWindowSpec,
  deriveTuningViewFlags,
  previewInputKey,
  REFLECTION_REFINE_HANDLERS,
  reflectionContextSpec,
  resolveActivePreviewWindow,
  type StagedBaseline,
} from "../refine-state";
import { scheduleKey } from "../schedule";
import type { ReflectionSeed } from "../types";
import { usePreviewWindows } from "./use-preview-windows";
import {
  type ManualPreviewResult,
  useReflectionRefineActions,
} from "./use-reflection-refine-actions";
import { useResumeReflectionRefinement } from "./use-resume-reflection-refinement";

export function useReflectionTuning({
  id,
  seed,
  onCancel,
  onCommitSuccess,
  onDiscardSuccess,
}: {
  id?: string;
  seed?: ReflectionSeed;
  onCancel: (id?: string) => void;
  onCommitSuccess: (id: string) => void;
  onDiscardSuccess?: () => void;
}) {
  const isNew = !id;
  const [capturedSeed] = useState(() => seed);
  const [seededLens, setSeededLens] = useState("");
  const [directLens, setDirectLens] = useState<string | null>(null);
  const [manualPreview, setManualPreview] =
    useState<ManualPreviewResult | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const existingQuery = useLiveCollection("reflection", {
    filter: id ? `id="${id}"` : undefined,
    enabled: !isNew,
  });
  const existing = existingQuery.records[0];
  const isEstablished = Boolean(existing?.current_lens_id);
  const isNeverSavedExisting = !isNew && Boolean(existing) && !isEstablished;

  const resume = useResumeReflectionRefinement({
    reflectionId: id,
    enabled: isNeverSavedExisting,
  });

  const scope = useScope({
    initial: () => createInitialReflectionRefineState(id),
    handlers: REFLECTION_REFINE_HANDLERS,
  });
  const state = useScopeState(scope);

  const windowSpec = useMemo(
    () =>
      deriveRefineWindowSpec({
        cadence: state.cadence,
        fromDate: state.fromDate,
        endDate: state.endDate,
        paused: state.paused,
        isEstablished,
      }),
    [state.cadence, state.fromDate, state.endDate, state.paused, isEstablished],
  );
  const stagedContextSpec = useMemo(
    () => reflectionContextSpec(itemsToSpec(state.context as ContextItem[])),
    [state.context],
  );

  const previewWindows = usePreviewWindows({
    windowSpec,
    contextSpec: stagedContextSpec,
    reflectionId: state.reflectionId ?? undefined,
    enabled: state.chipsSeeded,
  });
  const activeWindow = useMemo(
    () =>
      resolveActivePreviewWindow(
        previewWindows.windows,
        previewWindows.defaultWindowId,
        state.selectedWindowKey,
      ),
    [
      previewWindows.windows,
      previewWindows.defaultWindowId,
      state.selectedWindowKey,
    ],
  );

  const [baseline, setBaseline] = useState<StagedBaseline>(() => ({
    lensPrompt: "",
    scheduleKey: scheduleKey(windowSpec),
    contextKey: specKey(stagedContextSpec),
  }));

  const session = useRefineSession({
    target: "reflection",
    resumed: resume.seed,
    reflectionPreviewContext: {
      activeWindow,
      latestPreview: manualPreview?.output,
      lensPrompt: directLens ?? undefined,
      contextSpec: stagedContextSpec,
    },
  });

  const { name, adopt, rename } = useDraftName({
    target: "reflection",
    entityId: state.reflectionId,
    suggestedName: session.suggestedName,
  });

  const [prevChatLens, setPrevChatLens] = useState(session.latestLens);
  if (session.latestLens !== prevChatLens) {
    setPrevChatLens(session.latestLens);
    if (session.latestLens) {
      setDirectLens(null);
      setManualPreview(null);
    }
  }

  const effectiveLensPrompt = directLens ?? (session.latestLens || seededLens);
  const currentInputKey = previewInputKey(
    effectiveLensPrompt,
    stagedContextSpec,
    activeWindow,
  );

  const [prevChatPreview, setPrevChatPreview] = useState(session.preview);
  const [chatPreviewKey, setChatPreviewKey] = useState<string | null>(() =>
    session.preview ? currentInputKey : null,
  );
  if (session.preview !== prevChatPreview) {
    setPrevChatPreview(session.preview);
    if (session.preview) {
      setChatPreviewKey(currentInputKey);
      setManualPreview(null);
    }
  }

  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const waitingForResume = isNeverSavedExisting && !resume.ready;
    if (
      isNew ||
      !existing ||
      waitingForResume ||
      seededFor.current === existing.id
    ) {
      return;
    }
    seededFor.current = existing.id;

    const derived = deriveExistingReflectionSeed(
      existing,
      capturedSeed,
      isNeverSavedExisting ? resume.context : undefined,
    );
    const derivedSpec = deriveRefineWindowSpec({
      cadence: derived.cadence,
      fromDate: derived.fromDate,
      endDate: derived.endDate,
      paused: derived.paused,
      isEstablished,
    });
    const nextBaseline = {
      scheduleKey: scheduleKey(derivedSpec),
      contextKey: specKey(reflectionContextSpec(itemsToSpec(derived.context))),
    };

    void scope.dispatch({ type: "seedExisting", ...derived });

    if (isEstablished) {
      void getReflectionLens(existing.id).then((res) => {
        const prompt = res.isOk() ? res.value.prompt.trim() : "";
        setSeededLens(prompt);
        setBaseline({ lensPrompt: prompt, ...nextBaseline });
      });
      void session.start({ parentId: existing.id });
      return;
    }

    const resumedLens = resume.latestLens.trim();
    setSeededLens(resumedLens);
    setBaseline({ lensPrompt: resumedLens, ...nextBaseline });
    if (!resume.seed) {
      void session.start({ parentId: existing.id, prompt: derived.prompt });
    }
  }, [
    isNew,
    existing,
    isEstablished,
    isNeverSavedExisting,
    resume.ready,
    resume.seed,
    resume.context,
    resume.latestLens,
    capturedSeed,
    session.start,
    scope,
  ]);

  const actions = useReflectionRefineActions({
    isNew,
    reflectionId: state.reflectionId,
    session,
    windowSpec,
    contextSpec: stagedContextSpec,
    lensPrompt: effectiveLensPrompt,
    activeWindow,
    input: state.input,
    nameInput: state.nameInput,
    context: state.context as ContextItem[],
    adopt,
    rename,
    onReflectionCreated: (nextId) =>
      void scope.dispatch({ type: "setReflectionId", id: nextId }),
    onManualPreview: setManualPreview,
    onCommitSuccess,
    onDiscardSuccess: () => {
      setDiscardConfirmOpen(false);
      (onDiscardSuccess ?? (() => onCancel(undefined)))();
    },
  });

  const view = deriveTuningViewFlags({
    reflectionId: state.reflectionId,
    sessionStarted: session.started,
    effectiveLensPrompt,
    activeWindow,
    manualPreview,
    chatPreview: session.preview,
    chatPreviewKey,
    currentInputKey,
    windowSpecKey: scheduleKey(windowSpec),
    contextSpecKey: specKey(stagedContextSpec),
    baseline,
    creating: actions.creating,
    saving: actions.saving,
    discarding: actions.discarding,
    chatLoading: session.chat.isLoading,
  });

  const headerCopy = deriveRefineHeaderCopy({
    isNew,
    isEstablished,
    name,
    existingName: existing?.name,
    saving: actions.saving,
  });

  function handleSecondaryAction() {
    if (isEstablished) {
      onCancel(id);
      return;
    }
    if (state.reflectionId) {
      setDiscardConfirmOpen(true);
      return;
    }
    onCancel(undefined);
  }

  return {
    isNew,
    isEstablished,
    scope,
    state,
    session,
    previewWindows,
    activeWindow,
    effectiveLensPrompt,
    setDirectLens,
    headerCopy,
    discardConfirmOpen,
    setDiscardConfirmOpen,
    handleSecondaryAction,
    actions,
    ...view,
  };
}
