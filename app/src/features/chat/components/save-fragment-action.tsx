import { useState } from "react";
import { CheckIcon, PinIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveChatResponseAsFragment } from "../save-as-fragment";

interface SaveFragmentActionProps {
  /** The answer text to keep. */
  content: string;
  /** The chat this answer came from, recorded as the fragment's source. */
  clientId: string;
  /** Fires with the new fragment's id once it lands. */
  onSaved?: (fragmentId: string) => void;
}

/**
 * "Save as fragment" under one chat answer.
 *
 * Saving is deliberately one-shot per message: once an answer has been kept, the
 * button reports that rather than staying armed. Fragments are immutable and
 * every one costs a classification pass per colour, so a second click would be
 * an accidental duplicate far more often than a deliberate one.
 */
export function SaveFragmentAction({
  content,
  clientId,
  onSaved,
}: SaveFragmentActionProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (saving || saved || !content.trim()) return;
    setSaving(true);
    const res = await saveChatResponseAsFragment(content, { clientId });
    setSaving(false);
    if (res.isErr()) {
      toast.error("Failed to save fragment", {
        description: res.error.message,
      });
      return;
    }
    setSaved(true);
    toast.success("Saved as fragment");
    onSaved?.(res.value);
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      className="text-fg-3"
      onClick={() => void save()}
      disabled={saving || saved}
    >
      {saved ? <CheckIcon /> : <PinIcon />}
      {saved ? "Saved as fragment" : saving ? "Saving…" : "Save as fragment"}
    </Button>
  );
}
