import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Label } from "@/components/kalaido/text";
import { useActiveKalaidoscope } from "@/hooks/use-active-kalaidoscope";
import { cn } from "@/lib/css-utils";

interface PageHeaderProps {
  title: string;
  /**
   * The trail *below* the workspace, e.g. `["Projections", title, "Draft"]`.
   * The header supplies the workspace root itself — pages must not name it.
   */
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
  // With the sidebar collapsed to icons, the switcher no longer names the open
  // workspace — so the page does. Every in-scope page is rooted at it, which
  // makes reading the wrong workspace's data harder to do by accident. Outside
  // a workspace scope there is no root, and the page's own trail stands alone.
  const activeKalaidoscope = useActiveKalaidoscope();
  const displayCrumbs = [
    ...(activeKalaidoscope ? [activeKalaidoscope.displayName] : []),
    ...(crumb ?? []),
  ];

  return (
    <header
      className={cn("shrink-0 border-b border-line bg-background", className)}
    >
      <div className="flex min-h-[60px] items-center justify-between gap-4 px-6 py-3">
        <div className="min-w-0">
          {displayCrumbs.length > 0 && (
            <div className="mb-1 flex items-center gap-1.5">
              {displayCrumbs
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
