import type { ReactNode } from "react";
import { Label } from "#kalaido/text";
import { cn } from "#lib/css-utils";

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
        "flex min-h-0 flex-1 flex-col overflow-y-auto p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

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

export interface PaneHeaderProps {
  label: ReactNode;
  status?: ReactNode;
  className?: string;
}

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
