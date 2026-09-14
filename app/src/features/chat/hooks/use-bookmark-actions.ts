import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  type ChatBrief,
  generateBrief,
  saveBookmarks,
} from "@/api/kalaidoscope/chat";
import { updateColour } from "@/api/kalaidoscope/colours";

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
 * makes that idempotent), then does its own thing with the fragments; the
 * marks are re-read afterwards so the tray and the bubbles show what
 * happened.
 */
export function useBookmarkActions(
  clientId: string,
  refreshMarks: () => Promise<unknown>,
): BookmarkActions {
  const [phase, setPhase] = useState<BookmarkActionPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const saveAll = useCallback(async () => {
    setPhase("saving");
    setError(undefined);
    const res = await saveBookmarks(clientId);
    await refreshMarks();
    if (res.isErr()) {
      setPhase("idle");
      setError(res.error.message);
      toast.error("Couldn't save bookmarks", {
        description: res.error.message,
      });
      return null;
    }
    const created = res.value.saved.filter((s) => s.created).length;
    if (created > 0) {
      toast.success(`Saved ${created} fragment${created === 1 ? "" : "s"}`);
    }
    setPhase("idle");
    return res.value.saved.map((s) => s.fragmentId);
  }, [clientId, refreshMarks]);

  const saveAndColour = useCallback(
    async (colourId: string, colourName: string) => {
      const ids = await saveAll();
      if (!ids) return false;
      if (ids.length === 0) return true;
      setPhase("colouring");
      const res = await updateColour(colourId, { positiveExamples: ids });
      setPhase("idle");
      if (res.isErr()) {
        setError(res.error.message);
        toast.error(`Couldn't add to ${colourName}`, {
          description: res.error.message,
        });
        return false;
      }
      toast.success(
        `Added ${ids.length} fragment${ids.length === 1 ? "" : "s"} to ${colourName}`,
      );
      return true;
    },
    [saveAll],
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
