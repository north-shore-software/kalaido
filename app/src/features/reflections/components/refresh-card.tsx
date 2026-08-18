import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RefreshCardProps {
  regenerating: boolean;
  onRefresh: () => void;
}

export function RefreshCard({ regenerating, onRefresh }: RefreshCardProps) {
  return (
    <div className="rounded-none border border-line bg-card p-3.5">
      <div className="mb-2 flex items-center gap-2.5">
        <RefreshCwIcon className="size-4 text-fg-1" />
        <span className="text-item font-semibold">Refresh</span>
      </div>
      <p className="mb-3 text-body-sm leading-relaxed text-fg-2">
        Generate an updated snapshot based on the current window.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={onRefresh}
        disabled={regenerating}
      >
        {regenerating ? "Refreshing…" : "Regenerate"}
      </Button>
    </div>
  );
}
