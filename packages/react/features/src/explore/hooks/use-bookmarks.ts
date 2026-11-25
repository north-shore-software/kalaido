import {
  type MessageMark,
  setBookmark,
} from "@kalaido/client/kalaidoscope/chat";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useLiveCollectionWatching } from "@kalaido/hooks/use-live-collection";
import { useExternalWrite } from "@kalaido/state/live";
import type { UIMessage } from "ai";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

/** AI SDK ids and our own are url-safe; anything else never reaches a filter. */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/;

export interface Bookmarks {
  /** Persisted marks by UIMessage id, with any toggle still in flight applied. */
  marks: ReadonlyMap<string, MessageMark>;
  /** Set or clear a message's bookmark; optimistic, with a toast on failure. */
  toggle: (messageId: string, bookmarked: boolean) => Promise<void>;
}

/**
 * The bookmark state of every message in a chat, live. Read straight from
 * the persisted rows (the mark is server-side state, since the client cannot
 * write chat_message) and kept fresh by realtime events, so a resumed
 * conversation and a fresh one behave identically — before the first turn
 * there are simply no rows.
 *
 * Marks are keyed by the UIMessage id inside each row's content, which is
 * the id the live transcript uses, so a caller joins the two by `message.id`.
 */
export function useBookmarks(clientId: string): Bookmarks {
  const client = useKalaidoscopeClient();
  const valid = CLIENT_ID_RE.test(clientId);
  const { records } = useLiveCollectionWatching(
    "chat_message",
    ["chat_message"],
    {
      filter: `chat_conversation_id.external_conversation_id = "${clientId}"`,
      fields: "id,content,bookmarked,fragment_id",
      enabled: valid,
    },
  );

  // The toggle's own optimism, cleared once the row catches up or the call
  // fails; keyed by message id so two toggles never trample each other.
  const [inFlight, setInFlight] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );

  const bookmarkWrite = useExternalWrite<
    { messageId: string; bookmarked: boolean },
    void
  >({
    execute: async ({ messageId, bookmarked }) =>
      (await setBookmark(clientId, messageId, bookmarked)).map(() => undefined),
    concurrency: "allow",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "chat_message"),
    ],
  });

  const marks = useMemo(() => {
    const out = new Map<string, MessageMark>();
    for (const r of records) {
      const id = (r.content as UIMessage | null)?.id;
      if (!id) continue;
      out.set(id, {
        messageId: id,
        bookmarked: !!r.bookmarked,
        fragmentId: r.fragment_id || undefined,
      });
    }
    for (const [id, bookmarked] of inFlight) {
      const live = out.get(id);
      out.set(id, { messageId: id, ...live, bookmarked });
    }
    return out;
  }, [records, inFlight]);

  const toggle = useCallback(
    async (messageId: string, bookmarked: boolean) => {
      setInFlight((prev) => new Map(prev).set(messageId, bookmarked));
      const outcome = await bookmarkWrite.run({ messageId, bookmarked });
      if (outcome.status === "error") {
        toast.error(
          bookmarked ? "Couldn't bookmark" : "Couldn't remove bookmark",
          { description: outcome.error.message },
        );
      }
      setInFlight((prev) => {
        const next = new Map(prev);
        next.delete(messageId);
        return next;
      });
    },
    [bookmarkWrite],
  );

  return { marks, toggle };
}
