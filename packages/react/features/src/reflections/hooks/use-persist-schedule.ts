import type { WindowSpec } from "@kalaido/client/kalaidoscope/chat";
import { updateReflection } from "@kalaido/client/kalaidoscope/reflections";
import { useSyncRef } from "@kalaido/hooks/use-sync-ref";
import { useExternalWrite } from "@kalaido/state/live";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { scheduleKey } from "../schedule";

/**
 * Persist schedule-chip edits onto the reflection (a new `window_spec_versions`
 * entry) instead of carrying them through the chat. The first spec seen once
 * `ready` is true is taken as the already-persisted baseline — the creation
 * spec when creating, the record's own when refining an existing one — so mounting
 * never appends a redundant version; only a later change does, debounced.
 * `onPersisted` lets the owner react once persisted.
 */
export function usePersistSchedule({
  reflectionId,
  spec,
  ready,
  onPersisted,
}: {
  reflectionId: string | null;
  spec: WindowSpec;
  ready: boolean;
  onPersisted?: () => void;
}) {
  const key = scheduleKey(spec);
  const baselineRef = useRef<string | null>(null);
  const forRef = useRef<string | null>(null);
  const onPersistedRef = useRef(onPersisted);
  useSyncRef(onPersistedRef, onPersisted);

  const scheduleWrite = useExternalWrite<
    { id: string; windowSpec: WindowSpec },
    void
  >({
    execute: async ({ id, windowSpec }) =>
      (await updateReflection(id, { windowSpec })).map(() => undefined),
    concurrency: "allow",
  });

  useEffect(() => {
    if (!ready || !reflectionId) return;
    if (forRef.current !== reflectionId) {
      forRef.current = reflectionId;
      baselineRef.current = key;
      return;
    }
    if (baselineRef.current === key) return;
    const timer = setTimeout(() => {
      baselineRef.current = key;
      void scheduleWrite
        .run({ id: reflectionId, windowSpec: spec })
        .then((outcome) => {
          if (outcome.status === "error") {
            toast.error("Failed to update schedule", {
              description: outcome.error.message,
            });
            return;
          }
          if (outcome.status === "success") {
            onPersistedRef.current?.();
          }
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [ready, reflectionId, key, spec, scheduleWrite]);
}
