import type { KeyboardEvent, ReactNode } from "react";
import { PaneHeader } from "@/components/layout/page-chrome";
import { Textarea } from "@/components/ui/textarea";
import { ComposerSendButton } from "./composer-send-button";
import { cn } from "@/lib/css-utils";

export interface RefineComposerProps {
  title?: string;
  helperText?: string;
  helperTextClassName?: string;
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  onSubmit?: () => void;
  preparing?: boolean;
  preparingText?: string;
  /**
   * Rendered directly above the input footer — the slot the ContextBar uses on
   * pre-chat surfaces, mirroring its position above the ChatPanel composer.
   */
  beforeInput?: ReactNode;
}

export function RefineComposer({
  title,
  helperText,
  helperTextClassName,
  value = "",
  onChange,
  placeholder,
  disabled = false,
  busy = false,
  onSubmit,
  preparing = false,
  preparingText = "Preparing refine session…",
  beforeInput,
}: RefineComposerProps) {
  if (preparing) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-body-sm text-fg-2">{preparingText}</p>
      </div>
    );
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (onSubmit && value.trim() && !disabled && !busy) {
        onSubmit();
      }
    }
  };

  const isSubmitDisabled = !value.trim() || disabled || busy;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {title && <PaneHeader label={title} />}
      {helperText && (
        <div className="flex flex-1 items-center justify-center px-4 py-2">
          <p
            className={cn(
              "text-center text-body-sm text-fg-3",
              helperTextClassName,
            )}
          >
            {helperText}
          </p>
        </div>
      )}
      {beforeInput}
      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled || busy}
            className="max-h-40 min-h-0 flex-1 overflow-y-auto"
          />
          <ComposerSendButton onClick={onSubmit} disabled={isSubmitDisabled} />
        </div>
      </div>
    </div>
  );
}
