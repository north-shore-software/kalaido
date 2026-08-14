import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Label } from "@/components/kalaido/text";
import { cn } from "@/lib/css-utils";

interface PageHeaderProps {
  title: string;
  crumb?: string[];
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}

/**
 * The app top bar: bordered row with an uppercase breadcrumb, title and
 * action slot, plus an optional tabs row — the mock's KTopbar.
 */
export function PageHeader({
  title,
  crumb,
  description,
  actions,
  tabs,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn("shrink-0 border-b border-line bg-background", className)}
    >
      <div className="flex min-h-[60px] items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          {crumb && crumb.length > 0 && (
            <div className="mb-1 flex items-center gap-1.5">
              {crumb
                .map((c, i) => ({ c, i, key: `${i}-${c}` }))
                .map((seg) => (
                  <span key={seg.key} className="flex items-center gap-1.5">
                    {seg.i > 0 && (
                      <ChevronRightIcon className="size-2.5 text-fg-4" />
                    )}
                    <Label className="text-[10.5px]">{seg.c}</Label>
                  </span>
                ))}
            </div>
          )}
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2.5">{actions}</div>
        )}
      </div>
      {tabs && <div className="px-6">{tabs}</div>}
    </header>
  );
}

/**
 * Standard scrolling content area — owns the page's vertical scroll and the
 * 24px desktop gutter. Sits flush beneath the PageHeader.
 */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Full-bleed content area for split-pane / chat screens that manage their own
 * internal scroll and padding.
 */
export function PageCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
    >
      {children}
    </div>
  );
}

interface PaneHeaderProps {
  label: ReactNode;
  status?: ReactNode;
  className?: string;
}

/**
 * Bordered header for a split-pane surface: an uppercase label on the left and
 * an optional status slot on the right. Used by the "new" editors' preview panes.
 */
export function PaneHeader({ label, status, className }: PaneHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4",
        className,
      )}
    >
      <Label>{label}</Label>
      {status}
    </div>
  );
}
