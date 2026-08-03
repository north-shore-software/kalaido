import { cn } from "../../lib/css-utils";

/** Compact segmented control — the mock's KSeg. Pass `onChange` for an
 *  interactive toggle, omit it for a static display segment. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: readonly T[];
  value: T;
  onChange?: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5",
        className,
      )}
    >
      {items.map((it) => {
        const active = it === value;
        return (
          <button
            key={it}
            type="button"
            onClick={onChange ? () => onChange(it) : undefined}
            aria-pressed={active}
            className={cn(
              "rounded-[3px] px-3 py-1 text-xs font-semibold tracking-[0.02em] transition-colors",
              active
                ? "bg-fg-2 text-background"
                : "text-fg-3 hover:text-foreground",
              !onChange && "cursor-default",
            )}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}
