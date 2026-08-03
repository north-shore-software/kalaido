import markSrc from "@/assets/brand/kalaido-mark-black.png";
import { cn } from "@/lib/css-utils";

/**
 * The "K" mark. Source artwork is solid black; it's inverted to white under
 * the dark theme so it stays visible.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <img
      src={markSrc}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("size-5 shrink-0 select-none dark:invert", className)}
    />
  );
}
