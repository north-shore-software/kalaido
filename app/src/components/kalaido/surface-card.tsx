import type { ComponentProps } from "react";
import { cn } from "@/lib/css-utils";

/**
 * The raised settings surface: a bordered card with a faint inner ring. Exposed
 * as a class so non-`div` elements (e.g. a radio `<label>`) can share it.
 */
export const surfaceCardClass =
  "rounded-none border border-line-strong bg-surface-2 p-4";

export function SurfaceCard({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(surfaceCardClass, className)} {...props} />;
}
