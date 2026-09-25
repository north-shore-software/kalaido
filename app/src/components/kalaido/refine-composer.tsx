import type { ReactNode } from "react";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { PaneHeader } from "@/components/layout/page-chrome";
import { cn } from "@/lib/css-utils";
import { ComposerSendButton } from "./composer-send-button";
import { MentionTextarea } from "./mention-textarea";

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
  /**
   * Rendered above `beforeInput` — the slot creation surfaces use for the
   * optional name field, keeping the ContextBar in its usual position.
   */
  nameField?: ReactNode;
  /**
   * See {@link MentionTextarea}'s onMention. Pre-session surfaces own a context
   * selection (the ContextBar in `beforeInput`), so a mention picked here must
   * land in it exactly as it would in the chat panel after the session starts.
   */
  onMention?: (item: ContextItem) => void;
  /**
   * Replaces the helper text with content laid out like the tail of a chat
   * stream — where a page puts a {@link DecisionCard} before any session
   * exists, so the question sits where the conversation would.
   */
  children?: ReactNode;
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
  nameField,
  onMention,
  children,
}: RefineComposerProps) {
  if (preparing) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-body-sm text-fg-2">{preparingText}</p>
      </div>
    );
  }

  const submit = () => {
    if (onSubmit && value.trim() && !disabled && !busy) {
      onSubmit();
    }
  };

  const isSubmitDisabled = !value.trim() || disabled || busy;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {title && <PaneHeader label={title} />}
      {children ? (
        <div className="flex flex-1 flex-col justify-end space-y-3 overflow-y-auto p-4">
          {children}
        </div>
      ) : helperText ? (
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
      ) : null}
      {nameField}
      {beforeInput}
      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="flex items-end gap-2">
          <MentionTextarea
            value={value}
            onChange={(v) => onChange?.(v)}
            onSubmit={submit}
            onMention={onMention}
            placeholder={placeholder}
            disabled={disabled || busy}
            className="max-h-40 min-h-0 flex-1 overflow-y-auto"
          />
          <ComposerSendButton onClick={onSubmit} disabled={isSubmitDisabled} />
        </div>
      </div>
    </div>
  );
}
