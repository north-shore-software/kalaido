import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateProjection } from "@/api/kalaidoscope/projections";
import { updateReflection } from "@/api/kalaidoscope/reflections";

/**
 * The name of a projection/reflection while it is being drafted through a
 * refine chat. Owns the "who named it" question:
 *
 * - {@link adopt} seeds the state when the entity comes into being (or when a
 *   resumed draft is adopted): the starting name, and whether a person chose
 *   it (typed at creation, seeded from a fork) rather than a machine
 *   (prompt-derived fallback).
 * - While the user hasn't named it, every new model suggestion (see
 *   `RefineSession.suggestedName`) is applied automatically — locally and via
 *   PATCH, so lists and sidebars show the good name mid-draft.
 * - {@link rename} is the user taking ownership: it patches and permanently
 *   stops suggestions from overwriting.
 *
 * `name` stays null until {@link adopt} — callers fall back to their static
 * title until then.
 */
export function useDraftName({
  target,
  entityId,
  suggestedName,
}: {
  target: "projection" | "reflection";
  entityId: string | null;
  suggestedName: string;
}): {
  name: string | null;
  adopt: (initialName: string, userNamed: boolean) => void;
  rename: (next: string) => void;
} {
  const [name, setName] = useState<string | null>(null);
  const userNamed = useRef(false);

  const patch = useCallback(
    (id: string, next: string) =>
      target === "projection"
        ? updateProjection(id, { name: next })
        : updateReflection(id, { name: next }),
    [target],
  );

  const adopt = useCallback((initialName: string, named: boolean) => {
    userNamed.current = named;
    setName(initialName);
  }, []);

  // Auto-apply the model's suggestion. A failed background patch is not worth
  // a toast — the local name still shows, and the next suggestion retries.
  useEffect(() => {
    if (!entityId || name === null || userNamed.current) return;
    const next = suggestedName.trim();
    if (!next || next === name) return;
    setName(next);
    void patch(entityId, next);
  }, [entityId, name, suggestedName, patch]);

  const rename = useCallback(
    (next: string) => {
      userNamed.current = true;
      setName(next);
      if (!entityId) return;
      void patch(entityId, next).then((res) => {
        if (res.isErr()) {
          toast.error("Failed to rename", { description: res.error.message });
        }
      });
    },
    [entityId, patch],
  );

  return { name, adopt, rename };
}
