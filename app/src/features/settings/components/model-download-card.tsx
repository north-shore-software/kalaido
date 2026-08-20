import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SurfaceCard } from "@/components/kalaido";

export interface ModelDownloadCardProps {
  modelName: string;
  pulling: boolean;
  pullPct?: number | null;
  pullStatus?: string;
  pullError?: string | null;
  onDownload: () => void;
  onCancel: () => void;
}

export function ModelDownloadCard({
  modelName,
  pulling,
  pullPct,
  pullStatus,
  pullError,
  onDownload,
  onCancel,
}: ModelDownloadCardProps) {
  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-item font-medium text-fg-1">
            Download {modelName}
          </span>
          <span className="text-meta text-fg-3">
            The recommended model. Several GB — keep this page open while it
            downloads.
          </span>
        </div>
        {pulling ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="shrink-0"
          >
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={onDownload} className="shrink-0">
            <DownloadIcon />
            Download
          </Button>
        )}
      </div>
      {pulling && (
        <div className="flex flex-col gap-1.5">
          <Progress value={pullPct ?? null} />
          <span className="text-meta text-fg-3">
            {pullStatus}
            {pullPct !== null && pullPct !== undefined ? ` · ${pullPct}%` : ""}
          </span>
        </div>
      )}
      {pullError && <p className="text-meta text-critical-ink">{pullError}</p>}
    </SurfaceCard>
  );
}
