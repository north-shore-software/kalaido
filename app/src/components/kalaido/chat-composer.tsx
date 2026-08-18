import { type KeyboardEvent, useRef, useState } from "react";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { Textarea } from "@/components/ui/textarea";
import {
  buildMentionToken,
  type MentionKind,
  mentionQueryAt,
} from "@/lib/mentions";
import { ComposerSendButton } from "./composer-send-button";
import {
  MentionMenu,
  type MentionOption,
  useMentionOptions,
} from "./mention-menu";

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  quotaMessage?: string;
  /**
   * Fired when the user picks an entity from the @-mention menu, after its
   * token is inserted into the text. The owner must add the item to the active
   * context selection — a mention is a reference *into* the context, so a
   * composer without a context selection to update doesn't get a menu (omit
   * this prop to disable mentions).
   */
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  // The `@` position the user pressed Escape on. Comparing by position keeps
  // the menu closed while they continue typing the same word, but lets a new
  // `@` elsewhere reopen it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const mention = onMention ? mentionQueryAt(value, caret) : null;
  const menuOpen = mention !== null && dismissedAt !== mention.start;
  const { options, loading } = useMentionOptions(
    mention?.query ?? "",
    menuOpen,
  );
  // Clamped instead of reset-by-effect: the option list shrinks as the query
  // narrows, and a stale index must never point past it.
  const highlighted = Math.min(activeIndex, Math.max(options.length - 1, 0));

  function syncCaret() {
    setCaret(textareaRef.current?.selectionStart ?? 0);
  }

  function pick(option: MentionOption) {
    if (!mention || !onMention) return;
    const token = buildMentionToken(
      option.item.kind as MentionKind,
      option.item.id,
      option.item.label,
    );
    const next = `${value.slice(0, mention.start)}${token} ${value.slice(caret)}`;
    const nextCaret = mention.start + token.length + 1;
    onChange(next);
    onMention(option.item);
    setCaret(nextCaret);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // The menu owns navigation keys while it is open — including Enter, which
    // must accept the highlighted mention rather than submit the message.
    if (menuOpen && options.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((highlighted + delta + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(mention.start);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  const isSendDisabled = !value.trim() || disabled || !!quotaMessage;

  return (
    <div className="shrink-0 border-t p-4">
      {quotaMessage && (
        <p className="mb-2 border border-drifting/40 bg-drifting-wash px-3 py-2 text-meta text-drifting-ink">
          {quotaMessage}
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          {menuOpen && (options.length > 0 || loading) && (
            <MentionMenu
              options={options}
              activeIndex={highlighted}
              onPick={pick}
              onHover={setActiveIndex}
              loading={loading}
            />
          )}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart ?? 0);
            }}
            onSelect={syncCaret}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={!!quotaMessage}
            className="flex-1 min-h-0 max-h-40 overflow-y-auto"
          />
        </div>
        <ComposerSendButton onClick={onSubmit} disabled={isSendDisabled} />
      </div>
    </div>
  );
}
