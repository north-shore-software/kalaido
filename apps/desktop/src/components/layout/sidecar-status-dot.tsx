import type { SidecarPhase } from "@/api/app/local-scopes";
import { cn } from "@kalaido/primitives/lib/css-utils";

function phaseDotClass(phase: SidecarPhase): string {
  switch (phase) {
    case "running":
      return "bg-stable";
    case "spawning":
    case "starting":
      return "bg-drifting animate-pulse";
    case "stopping":
      return "bg-drifting";
    case "failed":
      return "bg-critical";
    default:
      return "bg-muted-foreground/50";
  }
}

interface SidecarStatusDotProps {
  phase: SidecarPhase;
  className?: string;
}

export function SidecarStatusDot({ phase, className }: SidecarStatusDotProps) {
  return (
    <span
      className={cn("size-1.5 rounded-full", phaseDotClass(phase), className)}
      aria-hidden
    />
  );
}
