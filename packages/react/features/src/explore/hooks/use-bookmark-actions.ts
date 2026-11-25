import {
  type ChatBrief,
  generateBrief,
  type MessageMark,
  saveBookmarks,
} from "@kalaido/client/kalaidoscope/chat";
import { updateColour } from "@kalaido/client/kalaidoscope/colours";
import { kalaidoscopeCollectionTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import { useExternalWrite } from "@kalaido/state/live";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export type BookmarkActionPhase = "idle" | "saving" | "colouring" | "briefing";

export interface BriefedBookmarks extends ChatBrief {
  /** The saved fragments the projection will read. */
  fragmentIds: string[];
}

export interface BookmarkActions {
  phase: BookmarkActionPhase;
  /** The last action's failure, until the next one starts. */
  error?: string;
  /**
   * Save every bookmarked turn as a fragment. Resolves to the fragment ids
   * (reused where a turn was already saved), or null on failure.
   */
  saveAll: () => Promise<string[] | null>;
  /** Save, then pin every fragment as a positive example of the colour. */
  saveAndColour: (colourId: string, colourName: string) => Promise<boolean>;
  /** Save, then ask what projection the conversation was working towards. */
  saveAndBrief: () => Promise<BriefedBookmarks | null>;
}

/**
 * The batch actions on a chat's bookmarks. Each starts by saving (the server
 * makes that idempotent), then does its own thing with the fragments; paired
 * invalidation refreshes `chat_message` marks automatically.
 */
export function useBookmarkActions(
  clientId: string,
  marks: ReadonlyMap<string, MessageMark>,
): BookmarkActions {
  const client = useKalaidoscopeClient();
  const [phase, setPhase] = useState<BookmarkActionPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const saveWrite = useExternalWrite<void, { readonly ids: readonly string[] }>(
    {
      execute: async () =>
        (await saveBookmarks(clientId)).map((r) => ({
          ids: r.saved.map((s) => s.fragmentId),
        })),
      concurrency: "ignore",
      invalidates: () => [
        kalaidoscopeCollectionTag(client.baseURL, "chat_message"),
      ],
    },
  );

  const colourWrite = useExternalWrite<
    { colourId: string; ids: string[] },
    void
  >({
    execute: async ({ colourId, ids }) =>
      (await updateColour(colourId, { positiveExamples: ids })).map(
        () => undefined,
      ),
    concurrency: "ignore",
    invalidates: () => [
      kalaidoscopeCollectionTag(client.baseURL, "colour_fragment"),
    ],
  });

  const saveAll = useCallback(async () => {
    const unsavedCount = Array.from(marks.values()).filter(
      (m) => m.bookmarked && !m.fragmentId,
    ).length;

    setPhase("saving");
    setError(undefined);
    const outcome = await saveWrite.run();
    if (outcome.status === "ignored") {
      setPhase("idle");
      return null;
    }
    if (outcome.status === "error") {
      setPhase("idle");
      setError(outcome.error.message);
      toast.error("Couldn't save bookmarks", {
        description: outcome.error.message,
      });
      return null;
    }
    if (unsavedCount > 0) {
      toast.success(
        `Saved ${unsavedCount} fragment${unsavedCount === 1 ? "" : "s"}`,
      );
    }
    setPhase("idle");
    return [...outcome.ids];
  }, [marks, saveWrite]);

  const saveAndColour = useCallback(
    async (colourId: string, colourName: string) => {
      const ids = await saveAll();
      if (!ids) return false;
      if (ids.length === 0) return true;
      setPhase("colouring");
      const outcome = await colourWrite.run({ colourId, ids });
      setPhase("idle");
      if (outcome.status === "ignored") return false;
      if (outcome.status === "error") {
        setError(outcome.error.message);
        toast.error(`Couldn't add to ${colourName}`, {
          description: outcome.error.message,
        });
        return false;
      }
      toast.success(
        `Added ${ids.length} fragment${ids.length === 1 ? "" : "s"} to ${colourName}`,
      );
      return true;
    },
    [saveAll, colourWrite],
  );

  const saveAndBrief = useCallback(async () => {
    const ids = await saveAll();
    if (!ids) return null;
    setPhase("briefing");
    const res = await generateBrief(clientId);
    setPhase("idle");
    if (res.isErr()) {
      setError(res.error.message);
      toast.error("Couldn't write the brief", {
        description: res.error.message,
      });
      return null;
    }
    return { ...res.value, fragmentIds: ids };
  }, [clientId, saveAll]);

  return { phase, error, saveAll, saveAndColour, saveAndBrief };
}
