import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { WindowSpec } from "@/api/kalaidoscope/chat";
import { updateReflection } from "@/api/kalaidoscope/reflections";
import { scheduleKey } from "@/features/reflections/schedule";

/**
 * Persist schedule-chip edits onto the reflection (a new `window_spec_versions`
 * entry) instead of carrying them through the chat. The first spec seen once
 * `ready` is true is taken as the already-persisted baseline — the creation
 * spec when creating, the record's own when refining an existing one — so mounting
 * never appends a redundant version; only a later change does, debounced.
 * `onPersisted` lets the owner refresh anything derived from the schedule
 * (the window list).
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
  onPersistedRef.current = onPersisted;

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
      void updateReflection(reflectionId, { windowSpec: spec }).then((res) => {
        if (res.isErr()) {
          toast.error("Failed to update schedule", {
            description: res.error.message,
          });
          return;
        }
        onPersistedRef.current?.();
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [ready, reflectionId, key, spec]);
}
