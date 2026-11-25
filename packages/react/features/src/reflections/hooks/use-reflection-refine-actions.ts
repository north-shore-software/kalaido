import type { WindowSpec } from "@kalaido/client/kalaidoscope/chat";
import {
  createReflection,
  updateReflection,
} from "@kalaido/client/kalaidoscope/reflections";
import { deriveName } from "@kalaido/client/lib/naming";
import type { ContextItem } from "@kalaido/components";
import type { RefineSession } from "@kalaido/hooks/use-refine-session";
import { useExternalWrite } from "@kalaido/state/live";
import { toast } from "sonner";

export function useReflectionRefineActions({
  isNew,
  reflectionId,
  session,
  windowSpec,
  input,
  nameInput,
  context,
  canCommit,
  adopt,
  rename,
  onReflectionCreated,
  onCommitSuccess,
}: {
  isNew: boolean;
  reflectionId: string | null;
  session: RefineSession;
  windowSpec: WindowSpec;
  input: string;
  nameInput: string;
  context: ContextItem[];
  canCommit: boolean;
  adopt: (name: string, userNamed: boolean) => void;
  rename: (name: string) => void;
  onReflectionCreated: (id: string) => void;
  onCommitSuccess: (id: string) => void;
}) {
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

  const creating = createWrite.isPending || session.creating;

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
    const ok = await session.start({
      parentId: created.id,
      prompt: text,
      context,
    });
    if (ok) {
      adopt(initialName, !!typedName);
      onReflectionCreated(created.id);
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

  return { creating, startReflection, finish, commitTitle };
}
