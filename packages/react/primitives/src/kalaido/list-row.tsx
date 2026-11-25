import type { ReactNode } from "react";
import { cn } from "#lib/css-utils";
import { Mono } from "./text";

interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Highlighted state — only meaningful for the interactive "list" variant. */
  selected?: boolean;
  onClick?: () => void;
  variant?: "list" | "card";
  className?: string;
}

/**
 * The shared identity row: leading visuals + a truncating title over a Mono
 * subtitle, with an optional trailing slot. Backs the master-detail lists
 * (Colours, Reflections) and the dashboard pins.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  selected,
  onClick,
  variant = "list",
  className,
}: ListRowProps) {
  const classes = cn(
    "flex items-center gap-4 rounded-none",
    variant === "card"
      ? "border border-line bg-surface-1 px-4 py-3 transition-colors hover:border-line-strong"
      : "px-4 py-3 text-left transition-colors",
    variant === "list" && (selected ? "bg-surface-2" : "hover:bg-surface-2/50"),
    className,
  );

  const titleClasses = cn(
    "w-full truncate text-row",
    variant === "card" || selected ? "font-semibold" : "font-medium",
  );

  const subtitleNode =
    subtitle != null ? (
      <Mono
        className={cn(
          "text-mono-sm",
          variant === "card" ? "text-fg-3" : "text-fg-4",
        )}
      >
        {subtitle}
      </Mono>
    ) : null;

  if (onClick) {
    return (
      <div
        className={cn(
          classes,
          "relative has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50",
        )}
      >
        {leading}
        <button
          type="button"
          data-row-primary
          onClick={onClick}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left outline-none after:absolute after:inset-0 after:content-['']"
        >
          <span className={titleClasses}>{title}</span>
          {subtitleNode}
        </button>
        {trailing && (
          <div className="relative z-10 pointer-events-none flex shrink-0 items-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            {trailing}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={classes}>
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={titleClasses}>{title}</span>
        {subtitleNode}
      </div>
      {trailing}
    </div>
  );
}
