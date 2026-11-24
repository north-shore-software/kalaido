import { useActiveKalaidoscope } from "@kalaido/hooks/use-active-kalaidoscope";
import { EditableText } from "@kalaido/primitives/kalaido/editable-text";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  crumb?: string[];
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
  onTitleCommit?: (next: string) => void;
}

export function PageHeader({
  title,
  crumb,
  description,
  actions,
  tabs,
  className,
  onTitleCommit,
}: PageHeaderProps) {
  const activeKalaidoscope = useActiveKalaidoscope();
  const displayCrumbs = [
    ...(activeKalaidoscope ? [activeKalaidoscope.displayName] : []),
    ...(crumb ?? []),
  ];

  return (
    <header
      className={cn("shrink-0 border-b border-line bg-background", className)}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          {displayCrumbs.length > 0 && (
            <div className="mb-2 flex items-center gap-1.5">
              {displayCrumbs
                .map((c, i) => ({ c, i, key: `${i}-${c}` }))
                .map((seg) => (
                  <span key={seg.key} className="flex items-center gap-1.5">
                    {seg.i > 0 && (
                      <CaretRightIcon className="size-2.5 text-fg-5" />
                    )}
                    <span
                      className={cn(
                        "font-mono text-crumb uppercase",
                        seg.i === displayCrumbs.length - 1
                          ? "text-fg-2"
                          : "text-fg-4",
                      )}
                    >
                      {seg.c}
                    </span>
                  </span>
                ))}
            </div>
          )}
          <h1 className="truncate font-display text-display pb-0.5">
            {onTitleCommit ? (
              <EditableText value={title} onCommit={onTitleCommit} />
            ) : (
              title
            )}
          </h1>
          {description && (
            <p className="mt-1 truncate text-meta text-fg-4">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        )}
      </div>
      {tabs && <div className="px-5">{tabs}</div>}
    </header>
  );
}
