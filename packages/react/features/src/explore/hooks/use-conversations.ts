import useSWR from "swr";
import { listConversations } from "@kalaido/client/kalaidoscope/chat";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";

export function useConversations() {
  const client = useKalaidoscopeClient();
  const { data, isLoading, mutate } = useSWR(
    ["chat_conversations", client.baseURL],
    () => listConversations(client),
  );
  return { conversations: data ?? [], loading: isLoading, refresh: mutate };
}
