import { createMathPlugin } from "@streamdown/math";
import {
  createContext,
  createElement,
  type JSX,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import { cn } from "#lib/css-utils";

export type MarkdownVariant = "document" | "chat";

export interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
  variant?: MarkdownVariant;
  className?: string;
  components?: StreamdownProps["components"];
  allowedTags?: StreamdownProps["allowedTags"];
  literalTagContent?: string[];
  onOpenLink?: (url: string) => void;
}

interface MdElementProps {
  node?: unknown;
  className?: string;
  children?: ReactNode;
}

const MarkdownOpenLinkContext = createContext<
  ((url: string) => void) | undefined
>(undefined);

function styled(tag: keyof JSX.IntrinsicElements, classes: string) {
  return ({
    node: _node,
    className,
    vAlign,
    ...props
  }: MdElementProps & { vAlign?: string }) => {
    const vAlignClass =
      vAlign === "top"
        ? "align-top"
        : vAlign === "bottom"
          ? "align-bottom"
          : vAlign === "middle"
            ? "align-middle"
            : undefined;
    return createElement(tag, {
      ...props,
      className: cn(classes, vAlignClass, className),
    });
  };
}

function MarkdownLink({
  node: _node,
  href,
  className,
  children,
  ...props
}: MdElementProps & { href?: string }) {
  const onOpenLink = useContext(MarkdownOpenLinkContext);
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
        if (onOpenLink) {
          onOpenLink(href);
        } else {
          window.open(href, "_blank", "noreferrer");
        }
      }}
    >
      {children}
    </a>
  );
}

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
  thead: styled("thead", ""),
  tbody: styled("tbody", ""),
  tfoot: styled("tfoot", ""),
  tr: styled("tr", ""),
  th: styled(
    "th",
    "border-b border-line-strong px-2 py-1 text-left font-mono text-label font-semibold text-fg-3 uppercase",
  ),
  td: styled("td", "border-b border-line px-2 py-1 align-top"),
  img: styled("img", "max-w-full"),
  a: MarkdownLink,
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

const markdownPlugins: StreamdownProps["plugins"] = {
  math: createMathPlugin({ singleDollarTextMath: true }),
};

export function MarkdownContent({
  content,
  streaming = false,
  variant = "document",
  className,
  components,
  allowedTags,
  literalTagContent,
  onOpenLink,
}: MarkdownContentProps) {
  const base = variant === "chat" ? chatComponents : documentComponents;
  const merged = useMemo(
    () => (components ? { ...base, ...components } : base),
    [base, components],
  );
  return (
    <MarkdownOpenLinkContext.Provider value={onOpenLink}>
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
        controls={false}
        lineNumbers={false}
        linkSafety={{ enabled: false }}
        plugins={markdownPlugins}
        components={merged}
        allowedTags={allowedTags}
        literalTagContent={literalTagContent}
        className={cn(variant === "document" && "text-pretty", className)}
      >
        {content}
      </Streamdown>
    </MarkdownOpenLinkContext.Provider>
  );
}
