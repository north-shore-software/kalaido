import { type KeyboardEvent, useRef, useState } from "react";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { Textarea } from "@/components/ui/textarea";
import {
  buildMentionToken,
  type MentionKind,
  mentionQueryAt,
} from "@/lib/mentions";
import {
  MentionMenu,
  type MentionOption,
  useMentionOptions,
} from "./mention-menu";

export interface MentionTextareaProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter without Shift, when the mention menu is not consuming the key. */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Fired when the user picks an entity from the @-mention menu, after its
   * token is inserted into the text. The owner must add the item to the active
   * context selection — a mention is a reference *into* the context, so a
   * composer without a context selection to update doesn't get a menu (omit
   * this prop to disable mentions).
   */
  onMention?: (item: ContextItem) => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

/**
 * A textarea with the @-mention menu: owns the caret, the query, the highlight
 * and every key press while the menu is open, so Enter accepts the highlighted
 * mention rather than submitting. Shared by every composer that can reference
 * workspace items — the chat composer and the pre-session refine composer.
 */
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  className,
  onMention,
  textareaRef: externalRef,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setCombinedRef = (node: HTMLTextAreaElement | null) => {
    (
      textareaRef as unknown as { current: HTMLTextAreaElement | null }
    ).current = node;
    if (typeof externalRef === "function") {
      externalRef(node);
    } else if (externalRef && "current" in externalRef) {
      (
        externalRef as unknown as { current: HTMLTextAreaElement | null }
      ).current = node;
    }
  };
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

  return (
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
        ref={setCombinedRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onSelect={syncCaret}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className={className}
      />
    </div>
  );
}
