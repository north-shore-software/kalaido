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
        // Skip messages that do not contain any renderable text (e.g., pure tool call turns).
        const hasText = msg.parts.some(
          (part) => part.type === "text" && part.text?.trim(),
        );
        if (!hasText) return null;

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
