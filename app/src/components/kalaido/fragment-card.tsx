import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils";
import { fragmentTypeIcon } from "./icons";
import { MarkdownContent } from "./markdown-content";
import { StatusPill } from "./status-pill";
import { Mono } from "./text";

const cardMarkdownComponents = {
  p: ({ children }: { children?: ReactNode }) => (
    <span className="block">{children}</span>
  ),
  a: ({ children }: { children?: ReactNode }) => (
    <span className="underline decoration-line-strong underline-offset-2">
      {children}
    </span>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img src={src} alt={alt} className="max-h-24 rounded object-cover" />
  ),
};

export function FragmentCard({
  type,
  title,
  time,
  preview,
  compact,
  rejected,
  onClick,
  className,
}: {
  type: string;
  title?: string;
  time?: ReactNode;
  colours?: number[];
  preview?: ReactNode;
  compact?: boolean;
  rejected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Icon = fragmentTypeIcon(type);
  const displayTitle = title || type;

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-none bg-surface-2">
            <Icon className="size-3.5 text-lime" />
          </span>
          <span className="truncate text-body-sm font-semibold">
            {displayTitle}
          </span>
        </div>
        {rejected ? (
          <StatusPill kind="critical">rejected</StatusPill>
        ) : (
          time != null && (
            <Mono className="shrink-0 text-mono-sm text-fg-4">{time}</Mono>
          )
        )}
      </div>
      {preview && (
        <div className="mt-2 line-clamp-3 font-mono text-mono-sm leading-relaxed text-fg-4">
          {typeof preview === "string" ? (
            <MarkdownContent
              content={preview}
              components={cardMarkdownComponents}
            />
          ) : (
            preview
          )}
        </div>
      )}
    </>
  );

  const classes = cn(
    "rounded-none border border-line border-l-2 border-l-lime-edge bg-surface-1",
    compact ? "p-3" : "p-3.5",
    rejected && "opacity-50",
    onClick &&
      "w-full cursor-pointer text-left transition-colors hover:bg-surface-2",
    className,
  );

  if (onClick) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> — markdown preview may contain interactive elements and nesting interactive elements inside a button is invalid.
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={classes}
        data-testid="fragment-card"
      >
        {content}
      </div>
    );
  }

  return (
    <div className={classes} data-testid="fragment-card">
      {content}
    </div>
  );
}
