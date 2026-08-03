import useSWR from "swr";
import { useKalaidoscopeClient } from "@/hooks/use-kalaidoscope-client.ts";
import { listConversations } from "@/api/kalaidoscope/chat.ts";

export function useConversations() {
  const client = useKalaidoscopeClient();
  const { data, isLoading, mutate } = useSWR(
    ["chat_conversations", client.baseURL],
    () => listConversations(client),
  );
  return { conversations: data ?? [], loading: isLoading, refresh: mutate };
}
