import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
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
          "max-w-[70%] rounded-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {content}
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
          <div className="max-w-[70%] rounded-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-muted text-foreground">
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
              <div className="max-w-[70%] rounded-md px-4 py-2.5 text-sm italic leading-relaxed text-muted-foreground">
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
          <div className="bg-muted rounded-md px-4 py-2.5 text-sm text-muted-foreground">
            …
          </div>
        </div>
      )}
    </>
  );
}
