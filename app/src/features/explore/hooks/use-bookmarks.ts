import type { UIMessage } from "ai";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { type MessageMark, setBookmark } from "@/api/kalaidoscope/chat";
import { useLiveCollectionWatching } from "@/hooks/use-live-collection";

/** AI SDK ids and our own are url-safe; anything else never reaches a filter. */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/;

export interface Bookmarks {
  /** Persisted marks by UIMessage id, with any toggle still in flight applied. */
  marks: ReadonlyMap<string, MessageMark>;
  /** Set or clear a message's bookmark; optimistic, with a toast on failure. */
  toggle: (messageId: string, bookmarked: boolean) => Promise<void>;
  /** Re-read the marks — after an action that changes them server-side. */
  refresh: () => Promise<unknown>;
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
  const valid = CLIENT_ID_RE.test(clientId);
  const { records, mutate } = useLiveCollectionWatching(
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
      const res = await setBookmark(clientId, messageId, bookmarked);
      if (res.isErr()) {
        toast.error(
          bookmarked ? "Couldn't bookmark" : "Couldn't remove bookmark",
          { description: res.error.message },
        );
      } else {
        await mutate();
      }
      setInFlight((prev) => {
        const next = new Map(prev);
        next.delete(messageId);
        return next;
      });
    },
    [clientId, mutate],
  );

  return { marks, toggle, refresh: mutate };
}
