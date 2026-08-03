import { cn } from "@/lib/css-utils.ts";

export function DiffLine({
  kind,
  width = "90%",
  className,
}: {
  kind: "add" | "del";
  width?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "h-3.5 w-[3px] shrink-0 rounded-sm",
          kind === "add" ? "bg-stable" : "bg-critical",
        )}
      />
      <span
        className={cn(
          "h-[7px] rounded-sm",
          kind === "add" ? "bg-stable-wash" : "bg-critical-wash",
        )}
        style={{ width }}
      />
    </div>
  );
}
