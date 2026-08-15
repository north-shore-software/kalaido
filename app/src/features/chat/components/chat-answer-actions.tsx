import { useState } from "react";
import { CheckIcon, CrosshairIcon, FileTextIcon, PinIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveChatResponseAsFragment } from "../save-as-fragment";

interface ChatAnswerActionsProps {
  /** The answer text to keep. */
  content: string;
  /** The chat this answer came from, recorded as the fragment's source. */
  clientId: string;
  /**
   * Start a fresh chat with the saved fragment as its subject. Omit to offer
   * saving alone.
   */
  onRefocus?: (fragmentId: string) => void;
  /**
   * Turn this answer into a living document: the end of the refocus loop, where
   * the last fragment stops being a stepping stone and becomes a projection.
   *
   * The answer is still saved as a fragment first — it is the record of where
   * the projection came from — but the projection consumes the *content*, as the
   * sample output its lens gets distilled from, not the fragment as an input.
   */
  onGraduate?: (args: { content: string }) => void;
}

/**
 * What can be done with one chat answer: keep it as ground truth, and narrow the
 * conversation onto it.
 *
 * Both routes go through the same fragment — refocusing saves first if it has to,
 * and reuses the fragment if the answer was already kept, so the two buttons can
 * never produce two copies of the same text.
 */
export function ChatAnswerActions({
  content,
  clientId,
  onRefocus,
  onGraduate,
}: ChatAnswerActionsProps) {
  const [busy, setBusy] = useState<"save" | "refocus" | "graduate" | null>(
    null,
  );
  const [fragmentId, setFragmentId] = useState<string | null>(null);

  /** The fragment for this answer, creating it on first use. */
  async function ensureFragment(): Promise<string | null> {
    if (fragmentId) return fragmentId;
    const res = await saveChatResponseAsFragment(content, { clientId });
    if (res.isErr()) {
      toast.error("Failed to save fragment", {
        description: res.error.message,
      });
      return null;
    }
    setFragmentId(res.value);
    return res.value;
  }

  async function save() {
    if (busy || fragmentId || !content.trim()) return;
    setBusy("save");
    const id = await ensureFragment();
    setBusy(null);
    if (id) toast.success("Saved as fragment");
  }

  async function refocus() {
    if (busy || !content.trim() || !onRefocus) return;
    setBusy("refocus");
    const id = await ensureFragment();
    setBusy(null);
    if (!id) return;
    onRefocus(id);
  }

  async function graduate() {
    if (busy || !content.trim() || !onGraduate) return;
    setBusy("graduate");
    const id = await ensureFragment();
    setBusy(null);
    if (!id) return;
    onGraduate({ content });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="text-fg-3"
        onClick={() => void save()}
        disabled={!!busy || !!fragmentId}
      >
        {fragmentId ? <CheckIcon /> : <PinIcon />}
        {fragmentId
          ? "Saved as fragment"
          : busy === "save"
            ? "Saving…"
            : "Save as fragment"}
      </Button>
      {onRefocus && (
        <Button
          variant="ghost"
          size="xs"
          className="text-fg-3"
          onClick={() => void refocus()}
          disabled={!!busy}
        >
          <CrosshairIcon />
          {busy === "refocus" ? "Starting…" : "Save & refocus"}
        </Button>
      )}
      {onGraduate && (
        <Button
          variant="ghost"
          size="xs"
          className="text-fg-3"
          onClick={() => void graduate()}
          disabled={!!busy}
        >
          <FileTextIcon />
          {busy === "graduate" ? "Creating…" : "Make a projection"}
        </Button>
      )}
    </>
  );
}
