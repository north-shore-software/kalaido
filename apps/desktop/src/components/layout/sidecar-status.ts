import type { SidecarPhase } from "@/api/app/local-scopes";

export function phaseLabel(phase: SidecarPhase): string {
  switch (phase) {
    case "running":
      return "Connected";
    case "spawning":
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}
