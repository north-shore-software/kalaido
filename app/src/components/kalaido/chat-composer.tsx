import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/css-utils";

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
        <Button
          size="icon-sm"
          onClick={onSubmit}
          disabled={isSendDisabled}
          className={cn(
            "size-[26px] clip-chamfer",
            isSendDisabled
              ? "border-line-strong bg-transparent text-fg-4"
              : "border-transparent bg-section text-section-foreground hover:opacity-[0.86]",
          )}
        >
          <SendIcon />
        </Button>
      </div>
    </div>
  );
}
