import type {
  ContextSpec,
  TimeWindow,
  WindowSpec,
} from "@kalaido/client/kalaidoscope/chat";
import {
  createReflection,
  discardReflectionDraft,
  previewReflection,
  saveReflectionTuning,
  updateReflection,
} from "@kalaido/client/kalaidoscope/reflections";
import { deriveName } from "@kalaido/client/lib/naming";
import type { ContextItem } from "@kalaido/components";
import {
  kalaidoscopeCollectionTag,
  kalaidoscopeEndpointTag,
} from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { useExternalWrite } from "@kalaido/state/live";
import { useState } from "react";
import { toast } from "sonner";
import { previewInputKey } from "../refine-state";

export interface ManualPreviewResult {
  readonly output: string;
  readonly inputKey: string;
  readonly fragmentCount: number;
}

export function useReflectionRefineActions({
  isNew,
  reflectionId,
  session,
  windowSpec,
  contextSpec,
  lensPrompt,
  activeWindow,
  input,
  nameInput,
  context,
  adopt,
  rename,
  onReflectionCreated,
  onManualPreview,
  onCommitSuccess,
  onDiscardSuccess,
}: {
  isNew: boolean;
  reflectionId: string | null;
  session: RefineSession;
  windowSpec: WindowSpec;
  contextSpec: ContextSpec;
  lensPrompt: string;
  activeWindow: TimeWindow | undefined;
  input: string;
  nameInput: string;
  context: ContextItem[];
  adopt: (name: string, userNamed: boolean) => void;
  rename: (name: string) => void;
  onReflectionCreated: (id: string) => void;
  onManualPreview: (result: ManualPreviewResult) => void;
  onCommitSuccess: (id: string) => void;
  onDiscardSuccess: () => void;
}) {
  const client = useKalaidoscopeClient();

  const invalidateReflectionTags = () => [
    kalaidoscopeCollectionTag(client.baseURL, "reflection"),
    kalaidoscopeCollectionTag(client.baseURL, "reflection_snapshot"),
    kalaidoscopeCollectionTag(client.baseURL, "reflection_refinement"),
    kalaidoscopeEndpointTag(client.baseURL, "reconcile"),
  ];

  const [previewLoading, setPreviewLoading] = useState(false);

  const createWrite = useExternalWrite<
    { initialName: string; ws: WindowSpec },
    { readonly id: string }
  >({
    execute: ({ initialName, ws }) => createReflection(initialName, ws),
    concurrency: "ignore",
  });

  const saveWrite = useExternalWrite<
    {
      targetId: string;
      refinementId?: string;
      ws: WindowSpec;
      spec: ContextSpec;
      prompt: string;
      name?: string;
    },
    { readonly id: string }
  >({
    execute: ({ targetId, refinementId, ws, spec, prompt, name }) =>
      saveReflectionTuning(targetId, {
        refinementId,
        windowSpec: ws,
        contextSpec: spec,
        lensPrompt: prompt,
        name,
      }),
    concurrency: "ignore",
    invalidates: invalidateReflectionTags,
  });

  const discardWrite = useExternalWrite<string, void>({
    execute: async (targetId) =>
      (await discardReflectionDraft(targetId)).map(() => undefined),
    concurrency: "ignore",
    invalidates: invalidateReflectionTags,
  });

  const renameWrite = useExternalWrite<{ id: string; next: string }, void>({
    execute: async ({ id: targetId, next }) =>
      (await updateReflection(targetId, { name: next })).map(() => undefined),
    concurrency: "ignore",
  });

  const creating = createWrite.isPending || session.creating;
  const saving = saveWrite.isPending || createWrite.isPending;
  const discarding = discardWrite.isPending;

  async function startReflection() {
    const text = input.trim();
    if (!text || creating) return;
    const typedName = nameInput.trim();
    const initialName = typedName || deriveName(text, "Untitled reflection");
    const created = await createWrite.run({ initialName, ws: windowSpec });
    if (created.status === "ignored") return;
    if (created.status === "error") {
      toast.error("Failed to create reflection", {
        description: created.error.message,
      });
      return;
    }
    const ok = await session.start({
      parentId: created.id,
      prompt: text,
      context,
      window: activeWindow,
    });
    if (ok) {
      adopt(initialName, !!typedName);
      onReflectionCreated(created.id);
    }
  }

  async function runManualPreview() {
    const trimmed = lensPrompt.trim();
    if (!trimmed || !activeWindow || previewLoading) return;
    const key = previewInputKey(trimmed, contextSpec, activeWindow);
    setPreviewLoading(true);
    try {
      const res = await previewReflection({
        reflectionId: reflectionId ?? undefined,
        lensPrompt: trimmed,
        contextSpec,
        window: activeWindow,
      });
      if (res.isErr()) {
        toast.error("Failed to generate preview", {
          description: res.error.message,
        });
        return;
      }
      onManualPreview({
        output: res.value.output,
        inputKey: key,
        fragmentCount: res.value.fragmentCount,
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function save() {
    const trimmedLens = lensPrompt.trim();
    if (!trimmedLens || saving) return;

    let targetId = reflectionId;
    if (!targetId) {
      const typedName = nameInput.trim();
      const initialName =
        typedName || deriveName(trimmedLens, "Untitled reflection");
      const created = await createWrite.run({ initialName, ws: windowSpec });
      if (created.status === "ignored") return;
      if (created.status === "error") {
        toast.error("Failed to create reflection", {
          description: created.error.message,
        });
        return;
      }
      targetId = created.id;
      adopt(initialName, !!typedName);
      onReflectionCreated(created.id);
    }

    const outcome = await saveWrite.run({
      targetId,
      refinementId: session.refinementId ?? undefined,
      ws: windowSpec,
      spec: contextSpec,
      prompt: trimmedLens,
    });
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to save reflection", {
        description: outcome.error.message,
      });
      return;
    }
    onCommitSuccess(targetId);
  }

  async function discardDraft() {
    if (!reflectionId) {
      onDiscardSuccess();
      return;
    }
    const outcome = await discardWrite.run(reflectionId);
    if (outcome.status === "ignored") return;
    if (outcome.status === "error") {
      toast.error("Failed to discard draft", {
        description: outcome.error.message,
      });
      return;
    }
    onDiscardSuccess();
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

  return {
    creating,
    saving,
    discarding,
    previewLoading,
    startReflection,
    runManualPreview,
    save,
    discardDraft,
    commitTitle,
  };
}
