import type { KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ComposerSendButton } from "./composer-send-button";

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  quotaMessage?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Message…",
  disabled = false,
  quotaMessage,
}: ChatComposerProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  const isSendDisabled = !value.trim() || disabled || !!quotaMessage;

  return (
    <div className="shrink-0 border-t p-4">
      {quotaMessage && (
        <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {quotaMessage}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={!!quotaMessage}
          className="flex-1 min-h-0 max-h-40 overflow-y-auto"
        />
        <ComposerSendButton onClick={onSubmit} disabled={isSendDisabled} />
      </div>
    </div>
  );
}
