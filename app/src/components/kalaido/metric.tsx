import type { ReactNode } from "react";
import { cn } from "@/lib/css-utils.ts";
import { Label } from "./text";

/** Big-number metric with optional progress bar. */
export function Metric({
  label,
  value,
  sub,
  valueClassName,
  bar,
  barClassName,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  bar?: string;
  barClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 flex-col gap-2", className)}>
      <Label>{label}</Label>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-[28px] leading-none font-bold tracking-tight",
            valueClassName,
          )}
        >
          {value}
        </span>
        {sub && <span className="text-xs text-fg-3">{sub}</span>}
      </div>
      {bar != null && (
        <div className="h-[5px] overflow-hidden rounded-sm bg-surface-3">
          <div
            className={cn("h-full", barClassName ?? "bg-fg-3")}
            style={{ width: bar }}
          />
        </div>
      )}
    </div>
  );
}
