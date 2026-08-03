import { RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/css-utils";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/kalaido";

export interface OllamaStatusCardProps {
  reachable: boolean;
  modelCount?: number;
  onRefresh: () => void;
}

export function OllamaStatusCard({
  reachable,
  modelCount = 0,
  onRefresh,
}: OllamaStatusCardProps) {
  return (
    <SurfaceCard className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            reachable ? "bg-stable" : "bg-critical",
          )}
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {reachable ? "Connected to Ollama" : "Ollama not reachable"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {reachable
              ? `${modelCount} model${modelCount === 1 ? "" : "s"} installed`
              : "Make sure Ollama is installed and running, then refresh."}
          </span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="shrink-0"
      >
        <RefreshCwIcon />
        Refresh
      </Button>
    </SurfaceCard>
  );
}
