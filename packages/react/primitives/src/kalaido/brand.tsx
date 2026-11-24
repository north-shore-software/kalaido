import markSrc from "@kalaido/brand/kalaido-k-dark.svg";
import smallMarkSrc from "@kalaido/brand/kalaido-k-small-dark.svg";
import { cn } from "#lib/css-utils";

export function Mark({
  small = false,
  className,
}: {
  small?: boolean;
  className?: string;
}) {
  return (
    <img
      src={small ? smallMarkSrc : markSrc}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("size-5 shrink-0 select-none", className)}
    />
  );
}
