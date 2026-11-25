import {
  listReflectionWindows,
  type ReflectionWindow,
} from "@kalaido/client/kalaidoscope/reflections";
import { kalaidoscopeEndpointSource } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveRead } from "@kalaido/state/live";
import { useMemo } from "react";

export const REFLECTION_WINDOWS_ENDPOINT = "reflection-windows";

/**
 * Live read for `GET /api/reflections/:id/windows`, automatically revalidated
 * when the reflection schedule, windows, or snapshots change.
 */
export function useReflectionWindows(reflectionId: string | undefined) {
  const client = useKalaidoscopeClient();
  const enabled = !!reflectionId;

  const source = useMemo(
    () =>
      kalaidoscopeEndpointSource<ReflectionWindow[]>({
        client,
        endpoint: REFLECTION_WINDOWS_ENDPOINT,
        params: reflectionId ? [reflectionId] : [],
        watch: ["reflection", "reflection_snapshot", "reflection_window"],
        enabled,
        fetch: async () => {
          if (!reflectionId) {
            return (await listReflectionWindows("")).map((r) => r.windows);
          }
          return (await listReflectionWindows(reflectionId)).map(
            (r) => r.windows,
          );
        },
      }),
    [client, reflectionId, enabled],
  );

  const read = useLiveRead(source);

  return {
    windows: read.data ?? [],
    isLoading: read.isLoading,
    status: read.status,
    error: read.error,
  };
}
