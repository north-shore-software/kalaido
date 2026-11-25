import { updateProjection } from "@kalaido/client/kalaidoscope/projections";
import { updateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { useExternalWrite } from "@kalaido/state/live";
import {
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

interface DraftNameState {
  name: string | null;
  userNamed: boolean;
}

type DraftNameEvent =
  | {
      readonly type: "adopt";
      readonly name: string;
      readonly userNamed: boolean;
    }
  | { readonly type: "applySuggestion"; readonly name: string }
  | { readonly type: "userRename"; readonly name: string };

export interface DraftNameSeed {
  readonly name: string;
  readonly userNamed: boolean;
}

/**
 * The name of a projection/reflection while it is being drafted through a
 * refine chat. Owns the "who named it" question:
 *
 * - {@link adopt} (or declarative `seed`) seeds the state when the entity comes
 *   into being (or when a resumed draft is adopted): the starting name, and
 *   whether a person chose it (typed at creation, seeded from a fork) rather
 *   than a machine (prompt-derived fallback).
 * - While the user hasn't named it, every new model suggestion (see
 *   `RefineSession.suggestedName`) is applied automatically — locally and via
 *   PATCH, so lists and sidebars show the good name mid-draft.
 * - {@link rename} is the user taking ownership: it patches and permanently
 *   stops suggestions from overwriting.
 *
 * `name` stays null until {@link adopt} or `seed` — callers fall back to their
 * static title until then.
 */
export function useDraftName({
  target,
  entityId,
  suggestedName,
  seed,
}: {
  target: "projection" | "reflection";
  entityId: string | null;
  suggestedName: string;
  seed?: DraftNameSeed | null;
}): {
  name: string | null;
  adopt: (initialName: string, userNamed: boolean) => void;
  rename: (next: string) => void;
} {
  const handlers: ScopeHandlers<DraftNameState, DraftNameEvent> = {
    adopt: (s, e) => {
      s.name = e.name;
      s.userNamed = e.userNamed;
    },
    applySuggestion: (s, e) => {
      if (s.userNamed) return;
      s.name = e.name;
    },
    userRename: (s, e) => {
      s.userNamed = true;
      s.name = e.name;
    },
  };
  const scope = useScope({
    initial: (): DraftNameState => ({ name: null, userNamed: false }),
    handlers,
  });
  const { name: localName, userNamed: localUserNamed } = useScopeState(scope);
  const name = localName ?? seed?.name ?? null;
  const userNamed =
    localName !== null ? localUserNamed : (seed?.userNamed ?? false);

  const renameWrite = useExternalWrite<{ id: string; next: string }, void>({
    execute: async ({ id, next }) => {
      const res =
        target === "projection"
          ? await updateProjection(id, { name: next })
          : await updateReflection(id, { name: next });
      return res.map(() => undefined);
    },
    concurrency: "allow",
  });

  const adopt = useCallback(
    (initialName: string, named: boolean) => {
      void scope.dispatch({
        type: "adopt",
        name: initialName,
        userNamed: named,
      });
    },
    [scope],
  );

  // Auto-apply the model's suggestion. A failed background patch is not worth
  // a toast — the local name still shows, and the next suggestion retries.
  useEffect(() => {
    if (!entityId || name === null || userNamed) return;
    const next = suggestedName.trim();
    if (!next || next === name) return;
    void scope.dispatch({ type: "applySuggestion", name: next });
    void renameWrite.run({ id: entityId, next });
  }, [entityId, name, userNamed, suggestedName, scope, renameWrite]);

  const rename = useCallback(
    (next: string) => {
      void scope.dispatch({ type: "userRename", name: next });
      if (!entityId) return;
      void renameWrite.run({ id: entityId, next }).then((outcome) => {
        if (outcome.status === "error") {
          toast.error("Failed to rename", {
            description: outcome.error.message,
          });
        }
      });
    },
    [entityId, scope, renameWrite],
  );

  return { name, adopt, rename };
}
