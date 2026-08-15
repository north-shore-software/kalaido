import { cn } from "@/lib/css-utils";
import type { UIMessage } from "ai";

export interface MessageBubbleProps {
  role: string;
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  return (
    <div
      className={cn("flex", role === "user" ? "justify-end" : "justify-start")}
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
}

export function ChatMessages({
  messages,
  greeting = "Hello! How can I help you today?",
  pending,
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

        return <MessageBubble key={msg.id} role={msg.role} content={content} />;
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
