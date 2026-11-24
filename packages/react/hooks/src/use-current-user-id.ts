import { useKalaidoscopeClient } from "#use-kalaidoscope-client";

export function useCurrentUserId(): string | null {
  const client = useKalaidoscopeClient();
  return client.authStore.record?.id ?? null;
}
