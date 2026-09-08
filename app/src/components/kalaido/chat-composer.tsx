import type { ContextItem } from "@/api/kalaidoscope/chat";
import { ComposerSendButton } from "./composer-send-button";
import { MentionTextarea } from "./mention-textarea";

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  quotaMessage?: string;
  /** See {@link MentionTextarea}'s onMention — omit to disable mentions. */
  onMention?: (item: ContextItem) => void;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Message…",
  disabled = false,
  quotaMessage,
  onMention,
}: ChatComposerProps) {
  const isSendDisabled = !value.trim() || disabled || !!quotaMessage;

  return (
    <div className="shrink-0 border-t p-4">
      {quotaMessage && (
        <p className="mb-2 border border-drifting/40 bg-drifting-wash px-3 py-2 text-meta text-drifting-ink">
          {quotaMessage}
        </p>
      )}

      <div className="flex items-end gap-2">
        <MentionTextarea
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onMention={onMention}
          placeholder={placeholder}
          disabled={!!quotaMessage}
          className="flex-1 min-h-0 max-h-40 overflow-y-auto"
        />
        <ComposerSendButton onClick={onSubmit} disabled={isSendDisabled} />
      </div>
    </div>
  );
}
