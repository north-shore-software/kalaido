import { createElement, type JSX, type ReactNode, useMemo } from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import { openSystemBrowser } from "@/api/app/os-integrations.ts";
import { cn } from "@/lib/css-utils.ts";

export type MarkdownVariant = "document" | "chat";

export interface MarkdownContentProps {
  /** Markdown source, typically LLM output. */
  content: string;
  /**
   * True while the source is still arriving from a live stream. Enables
   * incomplete-markdown handling so half-typed emphasis and unclosed fences
   * render stably instead of flickering between parses.
   */
  streaming?: boolean;
  /**
   * "document" — full prose surfaces (snapshots, previews) on the `body` role;
   * "chat" — message bubbles, scaled to their `text-sm` voice.
   */
  variant?: MarkdownVariant;
  className?: string;
  /** Extra element overrides merged over the variant defaults. */
  components?: StreamdownProps["components"];
  /** Custom tags allowed through sanitization, per Streamdown's contract. */
  allowedTags?: StreamdownProps["allowedTags"];
  /** Tags whose children are data labels, not markdown (e.g. mentions). */
  literalTagContent?: string[];
}

/**
 * Props Streamdown hands to element overrides: the intrinsic element's props
 * plus a `node` we must not forward to the DOM.
 */
interface MdElementProps {
  node?: unknown;
  className?: string;
  children?: ReactNode;
}

function styled(tag: keyof JSX.IntrinsicElements, classes: string) {
  return ({ node: _node, className, ...props }: MdElementProps) =>
    createElement(tag, { ...props, className: cn(classes, className) });
}

/**
 * Links must leave the app via the OS browser — inside the Tauri webview a
 * plain anchor would navigate the app window itself. Falls back to
 * window.open outside Tauri (Ladle, tests).
 */
function MarkdownLink({
  node: _node,
  href,
  className,
  children,
  ...props
}: MdElementProps & { href?: string }) {
  return (
    <a
      {...props}
      href={href}
      className={cn(
        "underline decoration-line-strong underline-offset-2 hover:decoration-current",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        if (!href) return;
        void openSystemBrowser(href).then((result) => {
          if (result.isErr()) window.open(href, "_blank", "noreferrer");
        });
      }}
    >
      {children}
    </a>
  );
}

/**
 * Type roles for markdown embedded in generated content, per DESIGN.md §2
 * "Type in generated content": headings are content, not chrome — h1 tops out
 * at `card-title` and never uses the display face (page titles only).
 */
const documentComponents: StreamdownProps["components"] = {
  p: styled("p", "my-2 text-body first:mt-0 last:mb-0"),
  h1: styled("h1", "mt-6 mb-2 text-card-title font-bold first:mt-0"),
  h2: styled("h2", "mt-5 mb-1.5 text-body font-bold first:mt-0"),
  h3: styled("h3", "mt-4 mb-1 text-body-sm font-semibold first:mt-0"),
  h4: styled("h4", "mt-4 mb-1 text-body-sm font-semibold first:mt-0"),
  h5: styled("h5", "mt-4 mb-1 text-body-sm font-semibold first:mt-0"),
  h6: styled("h6", "mt-4 mb-1 text-body-sm font-semibold first:mt-0"),
  ul: styled("ul", "my-2 list-disc space-y-1 pl-5 [&_ol]:my-1 [&_ul]:my-1"),
  ol: styled("ol", "my-2 list-decimal space-y-1 pl-5 [&_ol]:my-1 [&_ul]:my-1"),
  li: styled("li", "[&.task-list-item]:-ml-5 [&.task-list-item]:list-none"),
  input: styled("input", "mr-1.5 size-3 translate-y-px accent-current"),
  blockquote: styled(
    "blockquote",
    "my-2 border-l-2 border-line-strong pl-3 text-fg-3",
  ),
  hr: styled("hr", "my-4 border-t border-line"),
  pre: styled(
    "pre",
    "my-2 overflow-x-auto border border-line bg-surface-2 p-3 font-mono text-mono-sm",
  ),
  code: styled("code", ""),
  inlineCode: styled("code", "bg-surface-2 px-1 py-px font-mono text-[0.9em]"),
  table: styled("table", "my-2 w-full border-collapse text-body-sm"),
  th: styled(
    "th",
    "border-b border-line-strong px-2 py-1 text-left font-mono text-label font-semibold text-fg-3 uppercase",
  ),
  td: styled("td", "border-b border-line px-2 py-1 align-top"),
  a: MarkdownLink,
  // Diff contract: markdown-diff.ts injects <ins>/<del> into compare views.
  ins: styled("ins", "bg-stable-wash text-stable-ink no-underline"),
  del: styled("del", "bg-critical-wash text-critical-ink line-through"),
};

const chatComponents: StreamdownProps["components"] = {
  ...documentComponents,
  p: styled("p", "my-1.5 text-body-sm leading-relaxed first:mt-0 last:mb-0"),
  h1: styled("h1", "mt-4 mb-1.5 text-body font-bold first:mt-0"),
  h2: styled("h2", "mt-3 mb-1 text-body-sm font-bold first:mt-0"),
  h3: styled("h3", "mt-3 mb-1 text-body-sm font-semibold first:mt-0"),
  h4: styled("h4", "mt-3 mb-1 text-body-sm font-semibold first:mt-0"),
  h5: styled("h5", "mt-3 mb-1 text-body-sm font-semibold first:mt-0"),
  h6: styled("h6", "mt-3 mb-1 text-body-sm font-semibold first:mt-0"),
  ul: styled("ul", "my-1.5 list-disc space-y-0.5 pl-4 [&_ol]:my-1 [&_ul]:my-1"),
  ol: styled(
    "ol",
    "my-1.5 list-decimal space-y-0.5 pl-4 [&_ol]:my-1 [&_ul]:my-1",
  ),
  hr: styled("hr", "my-3 border-t border-line"),
};

/**
 * The one markdown renderer for LLM output. All built-in Streamdown chrome
 * (copy buttons, link modals, line numbers) is off — surfaces stay quiet and
 * every element is restyled onto the DESIGN.md token roles above.
 */
export function MarkdownContent({
  content,
  streaming = false,
  variant = "document",
  className,
  components,
  allowedTags,
  literalTagContent,
}: MarkdownContentProps) {
  const base = variant === "chat" ? chatComponents : documentComponents;
  const merged = useMemo(
    () => (components ? { ...base, ...components } : base),
    [base, components],
  );
  return (
    <Streamdown
      mode={streaming ? "streaming" : "static"}
      parseIncompleteMarkdown={streaming}
      controls={false}
      lineNumbers={false}
      linkSafety={{ enabled: false }}
      components={merged}
      allowedTags={allowedTags}
      literalTagContent={literalTagContent}
      className={cn(variant === "document" && "text-pretty", className)}
    >
      {content}
    </Streamdown>
  );
}
