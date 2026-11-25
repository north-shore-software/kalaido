import {
  type Conversation,
  listConversations,
} from "@kalaido/client/kalaidoscope/chat";
import { toError } from "@kalaido/client/lib/errors";
import { kalaidoscopeEndpointSource } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveRead } from "@kalaido/state/live";
import { err, ok } from "neverthrow";
import { useMemo } from "react";

export const CHAT_CONVERSATIONS_ENDPOINT = "chat-conversations";

export function useConversations() {
  const client = useKalaidoscopeClient();
  const source = useMemo(
    () =>
      kalaidoscopeEndpointSource<Conversation[]>({
        client,
        endpoint: CHAT_CONVERSATIONS_ENDPOINT,
        watch: ["chat_conversation"],
        fetch: async () => {
          try {
            return ok(await listConversations(client));
          } catch (e) {
            return err(toError(e));
          }
        },
      }),
    [client],
  );
  const { data, isLoading } = useLiveRead(source);
  return { conversations: data ?? [], loading: isLoading };
}
