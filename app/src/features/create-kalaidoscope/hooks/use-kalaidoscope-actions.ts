import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "@/api/app/settings.ts";
import type { KalaidoscopeAction } from "../types";

async function loadKalaidoscopeActions(
  kalaidoscopeId: string,
): Promise<KalaidoscopeAction[]> {
  const all =
    (await getSetting("kalaidoscopeActions")).unwrapOr(undefined) ?? {};
  return all[kalaidoscopeId] ?? [];
}

async function saveKalaidoscopeActions(
  kalaidoscopeId: string,
  actions: KalaidoscopeAction[],
): Promise<void> {
  const all =
    (await getSetting("kalaidoscopeActions")).unwrapOr(undefined) ?? {};
  await setSetting("kalaidoscopeActions", {
    ...all,
    [kalaidoscopeId]: actions,
  });
}

/**
 * Per-kalaidoscope home-page action cards (seeded from a template). Loads on mount and
 * persists dismissals to `kalaido-settings.json`. Mirrors `usePinnedProjections` — state
 * is per hook instance, re-read from disk on mount.
 */
export function useKalaidoscopeActions(kalaidoscopeId: string) {
  const [actions, setActions] = useState<KalaidoscopeAction[]>([]);

  useEffect(() => {
    if (!kalaidoscopeId) return;
    let cancelled = false;
    void (async () => {
      const a = await loadKalaidoscopeActions(kalaidoscopeId);
      if (!cancelled) setActions(a);
    })();
    return () => {
      cancelled = true;
    };
  }, [kalaidoscopeId]);

  const dismiss = useCallback(
    (id: string) => {
      setActions((prev) => {
        const next = prev.filter((a) => a.id !== id);
        void saveKalaidoscopeActions(kalaidoscopeId, next);
        return next;
      });
    },
    [kalaidoscopeId],
  );

  return { actions, dismiss };
}
