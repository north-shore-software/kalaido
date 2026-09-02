import type { UIMessage } from "ai";
import { Fragment, type ReactNode, useMemo } from "react";
import {
  type ContextSpec,
  diffContextSpecs,
  messageContextSpec,
  messageWindow,
  type TimeWindow,
} from "@/api/kalaidoscope/chat";
import { useContextSources } from "@/hooks/use-context-sources";
import { useFragmentLabels } from "@/hooks/use-fragment-labels";
import { cn } from "@/lib/css-utils";
import { formatWindowRange } from "@/lib/datetime";
import { mentionsToTags, splitMentions } from "@/lib/mentions";
import { ColourSwatch } from "./colour";
import { KIND_ABBREV } from "./context-bar/state";
import { MarkdownContent } from "./markdown-content";

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
        className="inline rounded-none border border-current/25 bg-current/10 px-1 font-medium whitespace-nowrap"
      >
        @{seg.label}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are a pure derivation of content
      <span key={i}>{seg.text}</span>
    ),
  );
}

/**
 * The same chip, reachable from inside rendered markdown: `mentionsToTags`
 * rewrites the wire tokens into <kmention> tags, allowlisted below so the
 * label rides through sanitization as literal text rather than prose.
 */
const mentionTagComponents = {
  kmention: (props: Record<string, unknown>) => (
    <span className="inline rounded-none border border-current/25 bg-current/10 px-1 font-medium whitespace-nowrap">
      {props.children as ReactNode}
    </span>
  ),
};
const mentionAllowedTags = { kmention: [] as string[] };
const mentionLiteralTags = ["kmention"];

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
          "max-w-[70%] rounded-none px-4 py-2.5 text-body-sm leading-relaxed break-words",
          role === "user"
            ? "bg-section text-section-foreground font-medium whitespace-pre-wrap"
            : "bg-surface-2 text-fg-1",
        )}
      >
        {role === "user" ? (
          // User text is verbatim input — rendering a literal `# note` as a
          // heading would misrepresent what was typed.
          <MessageText content={content} />
        ) : (
          <MarkdownContent
            variant="chat"
            streaming
            content={mentionsToTags(content)}
            components={mentionTagComponents}
            allowedTags={mentionAllowedTags}
            literalTagContent={mentionLiteralTags}
          />
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Marks where the context changed in the transcript, with the same change the
 * next turn's prompt was built from. Spec-level and diffed against the previous
 * spec in the stream (see {@link diffContextSpecs}); the opening spec of a
 * conversation renders as a plain summary, except the default whole scope of a
 * fresh chat, which is not a change worth marking. A re-emitted identical spec
 * diffs to nothing and renders nothing.
 */
function ContextSpecDivider({
  spec,
  prevSpec,
}: {
  spec: ContextSpec;
  prevSpec: ContextSpec | null;
}) {
  const sources = useContextSources();
  const delta = useMemo(
    () => diffContextSpecs(prevSpec, spec),
    [prevSpec, spec],
  );
  const fragmentIds = useMemo(
    () =>
      [...delta.added, ...delta.removed]
        .filter((it) => it.kind === "Fragment")
        .map((it) => it.id),
    [delta],
  );
  const fragmentLabels = useFragmentLabels(fragmentIds);

  const isFirst = prevSpec === null;
  if (delta.added.length === 0 && delta.removed.length === 0) return null;
  if (
    isFirst &&
    delta.added.length === 1 &&
    delta.added[0].kind === "WholeScope"
  ) {
    return null;
  }

  // A stored spec holds bare ids; resolve display labels like the bar does.
  const display = (it: (typeof delta.added)[number]) => {
    switch (it.kind) {
      case "WholeScope":
        return "whole scope";
      case "Summaries":
        return "summaries";
      case "Type":
        return sources.types.find((s) => s.value === it.id)?.label ?? it.label;
      case "Colour":
        return sources.colours.find((s) => s.id === it.id)?.name ?? it.label;
      case "Projection":
        return (
          sources.projections.find((s) => s.id === it.id)?.name ?? it.label
        );
      case "Reflection":
        return (
          sources.reflections.find((s) => s.id === it.id)?.name ?? it.label
        );
      case "Fragment":
        return `@${fragmentLabels.get(it.id) ?? it.label}`;
    }
  };

  const entry = (it: (typeof delta.added)[number], sign: "+" | "−" | null) => {
    const swatch =
      it.kind === "Colour"
        ? sources.colours.find((s) => s.id === it.id)?.value
        : undefined;
    return (
      <span
        key={`${sign}:${it.kind}:${it.id}`}
        className={cn(
          "inline-flex max-w-56 items-center gap-1 whitespace-nowrap",
          sign === "−" && "text-fg-5 line-through",
        )}
      >
        {sign && <span className="shrink-0">{sign}</span>}
        {it.kind !== "WholeScope" &&
          it.kind !== "Summaries" &&
          it.kind !== "Fragment" && (
            <span className="shrink-0 text-[9px] font-bold uppercase text-fg-5">
              {KIND_ABBREV[it.kind]}
            </span>
          )}
        {swatch != null && <ColourSwatch value={swatch} size={8} />}
        <span className="min-w-0 truncate">{display(it)}</span>
      </span>
    );
  };

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="h-px flex-1 bg-line" />
      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 font-mono text-mono-sm text-fg-4">
        <span className="font-bold uppercase text-fg-5">Context</span>
        {delta.added.map((it) => entry(it, isFirst ? null : "+"))}
        {delta.removed.map((it) => entry(it, "−"))}
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * Marks where a reflection refinement's target window was set or moved. The
 * first one states the window; later ones show it changing.
 */
function WindowDivider({
  window: win,
  isFirst,
}: {
  window: TimeWindow;
  isFirst: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <div className="h-px flex-1 bg-line" />
      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 font-mono text-mono-sm text-fg-4">
        <span className="font-bold uppercase text-fg-5">Window</span>
        <span className="whitespace-nowrap">
          {isFirst ? "" : "→ "}
          {formatWindowRange(win.start, win.end)}
        </span>
      </div>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

// null = the tool is bookkeeping the user never needs narrated (its effect
// shows up elsewhere in the UI), so a text-less turn stays silent.
// apply_result is the server-fabricated part carrying the executed preview —
// its effect is the preview pane itself.
const TOOL_MESSAGES: Record<string, string | null> = {
  update_lens: "Updated the lens.",
  apply_result: null,
  suggest_name: null,
  // The chat's summaries-mode reads narrate themselves (readNoticesFor).
  read_fragment: null,
  read_thing: null,
};

/**
 * One line per read the summaries-mode chat made during the turn. Handles both
 * the live shape (`dynamic-tool` with `toolName`/`input`) and the persisted one
 * (`tool-<name>` with `data.input`), like toolNoticeFor.
 */
function readNoticesFor(msg: UIMessage): string[] {
  const notices: string[] = [];
  for (const part of msg.parts) {
    const p = part as {
      type?: string;
      toolName?: string;
      input?: unknown;
      data?: { input?: unknown };
    };
    const name =
      p.type === "dynamic-tool"
        ? p.toolName
        : p.type?.startsWith("tool-")
          ? p.type.slice("tool-".length)
          : undefined;
    if (name !== "read_fragment" && name !== "read_thing") continue;
    const input = (p.input ?? p.data?.input) as { ids?: string[] } | undefined;
    const n = input?.ids?.length ?? 0;
    notices.push(
      name === "read_fragment"
        ? `Read ${n} fragment${n === 1 ? "" : "s"} in full.`
        : `Read ${n} thing${n === 1 ? "" : "s"} from the map.`,
    );
  }
  return notices;
}

/**
 * Notices the refinement server attaches to an assistant turn as `data-*`
 * parts (persisted and live shapes are identical): the count-pin lint and
 * apply failures. Rendered as italic rows under the turn; styling is minimal
 * on purpose (visual pass tracked in the design handoff).
 */
function dataNoticesFor(msg: UIMessage): string[] {
  const notices: string[] = [];
  for (const part of msg.parts) {
    const p = part as {
      type?: string;
      data?: { match?: string; message?: string; start?: string; end?: string };
    };
    if (p.type === "data-lens_seed") {
      notices.push("Starting from the current lens.");
    } else if (p.type === "data-window_reapply") {
      notices.push(
        p.data?.start && p.data?.end
          ? `Regenerated the preview for ${formatWindowRange(p.data.start, p.data.end)}.`
          : "Regenerated the preview for the selected window.",
      );
    } else if (p.type === "data-refine_lint" && p.data?.match) {
      notices.push(
        `Heads up: the lens pins a fixed count (“${p.data.match}”), so it may drop content when the sources change.`,
      );
    } else if (p.type === "data-refine_error") {
      notices.push(
        p.data?.message ||
          "Generating the preview failed — send another message to retry.",
      );
    }
  }
  return notices;
}

// Server-fabricated turns that carry a lens part without the model having
// drafted anything: the seeded current lens, and a re-apply to another window.
// Their own notice (dataNoticesFor) replaces the "Updated the lens." one.
const FABRICATED_TURN_PARTS = ["data-lens_seed", "data-window_reapply"];

function toolNoticeFor(msg: UIMessage): string | null {
  if (
    msg.parts.some((p) =>
      FABRICATED_TURN_PARTS.includes((p as { type?: string }).type ?? ""),
    )
  ) {
    return null;
  }
  for (const part of msg.parts) {
    const p = part as { type?: string; toolName?: string };
    const name =
      p.type === "dynamic-tool"
        ? p.toolName
        : p.type?.startsWith("tool-")
          ? p.type.slice("tool-".length)
          : undefined;
    if (!name) continue;
    const notice = TOOL_MESSAGES[name];
    if (notice !== null) return notice ?? `Called ${name}.`;
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
  // System messages carry no chat text. Those with a `context_spec` or
  // `window` part mark where the context / target window changed and render
  // as dividers at that position; the rest (`pinned_ids`) stay unrendered.
  const chatMessageCount = messages.filter((m) => m.role !== "system").length;
  let prevSpec: ContextSpec | null = null;
  let prevWindow: TimeWindow | null = null;

  return (
    <>
      {chatMessageCount === 0 && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-none px-4 py-2.5 text-body-sm leading-relaxed whitespace-pre-wrap break-words bg-surface-2 text-fg-1">
            {greeting}
          </div>
        </div>
      )}
      {messages.map((msg) => {
        if (msg.role === "system") {
          const spec = messageContextSpec(msg);
          const win = messageWindow(msg);
          if (!spec && !win) return null;
          const before = prevSpec;
          if (spec) prevSpec = spec;
          const windowBefore = prevWindow;
          if (win) prevWindow = win;
          return (
            <Fragment key={msg.id}>
              {win && (
                <WindowDivider window={win} isFirst={windowBefore === null} />
              )}
              {spec && <ContextSpecDivider spec={spec} prevSpec={before} />}
            </Fragment>
          );
        }

        const hasText = msg.parts.some(
          (part) => part.type === "text" && part.text?.trim(),
        );
        const dataNotices =
          msg.role === "assistant"
            ? [...dataNoticesFor(msg), ...readNoticesFor(msg)]
            : [];
        const noticeRows = dataNotices.map((notice, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: notices are a pure derivation of the message's parts
          <div key={`${msg.id}-notice-${i}`} className="flex justify-start">
            <div className="max-w-[70%] rounded-none px-4 py-1.5 text-body-sm italic leading-relaxed text-fg-4">
              {notice}
            </div>
          </div>
        ));

        if (!hasText) {
          const notice = toolNoticeFor(msg);
          if (!notice && noticeRows.length === 0) return null;
          return (
            <Fragment key={msg.id}>
              {notice && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-none px-4 py-2.5 text-body-sm italic leading-relaxed text-fg-4 bg-surface-2">
                    {notice}
                  </div>
                </div>
              )}
              {noticeRows}
            </Fragment>
          );
        }

        // A summaries-mode turn can carry text on both sides of its reads.
        const content = msg.parts
          .filter((part) => part.type === "text" && part.text?.trim())
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n\n");

        return (
          <Fragment key={msg.id}>
            <MessageBubble
              role={msg.role}
              content={content}
              actions={
                msg.role === "assistant"
                  ? assistantActions?.({ message: msg, content })
                  : undefined
              }
            />
            {noticeRows}
          </Fragment>
        );
      })}

      {pending && (
        <div className="flex justify-start">
          <div className="bg-surface-2 rounded-none px-4 py-2.5 text-body-sm text-fg-4">
            …
          </div>
        </div>
      )}
    </>
  );
}
