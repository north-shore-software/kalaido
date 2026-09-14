import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client.ts";

export function useCurrentUserId(): string | null {
  const client = useKalaidoscopeClient();
  return client.authStore.record?.id ?? null;
}
