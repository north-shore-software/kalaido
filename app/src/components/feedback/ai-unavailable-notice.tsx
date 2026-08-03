import { TriangleAlert } from "lucide-react";
import { settingsTransitions } from "@/features/settings/pages/Settings.transitions";
import { cn } from "@/lib/css-utils";
import { RouteLink } from "@/routes/route-link";

export function AiUnavailableNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
      <span>Local AI is unavailable.</span>
      <RouteLink
        transition={settingsTransitions.selectSection}
        params={{ section: "local-ai" }}
        className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
      >
        Set it up
      </RouteLink>
    </div>
  );
}
