import { cn } from "@/lib/css-utils";

export function truncatePath(path: string, maxSegments = 3): string {
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep).filter(Boolean);
  if (parts.length <= maxSegments) return path;
  return `…/${parts.slice(-maxSegments).join("/")}`;
}

interface LocationLabelProps {
  location: string;
  title?: string;
  truncate?: boolean;
  className?: string;
}

export function LocationLabel({
  location,
  title,
  truncate = true,
  className,
}: LocationLabelProps) {
  const displayLocation = truncate ? truncatePath(location) : location;
  return (
    <span
      className={cn(
        "min-w-0 font-mono text-mono-sm text-fg-4",
        truncate ? "truncate" : "break-all",
        className,
      )}
      title={title ?? location}
    >
      {displayLocation}
    </span>
  );
}
