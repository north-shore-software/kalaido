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
}

export function LocationLabel({
  location,
  title,
  truncate = true,
}: LocationLabelProps) {
  const displayLocation = truncate ? truncatePath(location) : location;
  return (
    <span
      className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70"
      title={title ?? location}
    >
      {displayLocation}
    </span>
  );
}
