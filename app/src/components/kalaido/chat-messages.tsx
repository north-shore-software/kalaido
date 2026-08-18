import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
import { splitMentions } from "@/lib/mentions";
import type { UIMessage } from "ai";

export interface MessageBubbleProps {
  role: string;
  content: string;
  /**
   * Controls shown beneath the bubble, revealed on hover. Kept as an opaque
   * slot so this component stays presentational — what can be *done* with a
   * message is the caller's business, not the transcript's.
   */
  actions?: ReactNode;
}

/**
 * Message text with mention tokens rendered as chips. The raw `@[Kind:id|Label]`
 * wire form is what persists (see lib/mentions.ts), so this is the one place
 * transcripts translate it back into something readable. Untagged messages
 * come back as a single text segment and render exactly as before.
 */
function MessageText({ content }: { content: string }) {
  const segments = splitMentions(content);
  if (segments.length === 1 && segments[0].type === "text") return content;
  return segments.map((seg, i) =>
    seg.type === "mention" ? (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are a pure derivation of content
        key={i}
        // `currentColor`-derived so the chip reads on both the primary (user)
        // and muted (assistant) bubble backgrounds without per-role styling.
        className="inline rounded-sm border border-current/25 bg-current/10 px-1 font-medium whitespace-nowrap"
      >
        @{seg.label}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are a pure derivation of content
      <span key={i}>{seg.text}</span>
    ),
  );
}

export function MessageBubble({ role, content, actions }: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "group/message flex flex-col gap-1",
        role === "user" ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[70%] rounded-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          role === "user"
            ? "bg-section text-section-foreground font-medium"
            : "bg-surface-2 text-fg-1",
        )}
      >
        <MessageText content={content} />
      </div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

const TOOL_MESSAGES: Record<string, string> = {
  update_draft: "Updated the draft.",
};

function toolNoticeFor(msg: UIMessage): string | null {
  for (const part of msg.parts) {
    const p = part as { type?: string; toolName?: string };
    const name =
      p.type === "dynamic-tool"
        ? p.toolName
        : p.type?.startsWith("tool-")
          ? p.type.slice("tool-".length)
          : undefined;
    if (name) return TOOL_MESSAGES[name] ?? `Called ${name}.`;
  }
  return null;
}

export interface ChatMessagesProps {
  messages: UIMessage[];
  greeting?: string;
  pending?: boolean;
  /**
   * Controls to attach under each assistant message that produced text — e.g.
   * capturing the answer as a fragment. Omit to render a plain transcript.
   */
  assistantActions?: (args: {
    message: UIMessage;
    content: string;
  }) => ReactNode;
}

export function ChatMessages({
  messages,
  greeting = "Hello! How can I help you today?",
  pending,
  assistantActions,
}: ChatMessagesProps) {
  // Persisted history can include the `pinned_ids`/`context_spec` system
  // messages the backend uses to track context over time; they carry no chat
  // text, so keep them in the stream but never render them as bubbles.
  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <>
      {visibleMessages.length === 0 && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-none px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-surface-2 text-fg-1">
            {greeting}
          </div>
        </div>
      )}
      {visibleMessages.map((msg) => {
        const hasText = msg.parts.some(
          (part) => part.type === "text" && part.text?.trim(),
        );

        if (!hasText) {
          const notice = toolNoticeFor(msg);
          if (!notice) return null;
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[70%] rounded-none px-4 py-2.5 text-sm italic leading-relaxed text-fg-4 bg-surface-2">
                {notice}
              </div>
            </div>
          );
        }

        const content = msg.parts
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");

        return (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={content}
            actions={
              msg.role === "assistant"
                ? assistantActions?.({ message: msg, content })
                : undefined
            }
          />
        );
      })}

      {pending && (
        <div className="flex justify-start">
          <div className="bg-surface-2 rounded-none px-4 py-2.5 text-sm text-fg-4">
            …
          </div>
        </div>
      )}
    </>
  );
}
