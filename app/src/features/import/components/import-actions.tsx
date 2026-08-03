import type { IngestPhase } from "@/api/kalaidoscope/ingest";
import { Button } from "@/components/ui/button";
import { FileIcon, UploadIcon } from "lucide-react";

export interface ImportActionsProps {
  phase: IngestPhase;
  running: boolean;
  onImport: () => void;
  onCancel: () => void;
  onViewStream: () => void;
  onImportAnother: () => void;
  disabledImport?: boolean;
}

export function ImportActions({
  phase,
  running,
  onImport,
  onCancel,
  onViewStream,
  onImportAnother,
  disabledImport = false,
}: ImportActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {running ? (
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      ) : phase === "done" ? (
        <Button size="sm" onClick={onViewStream}>
          View in stream
        </Button>
      ) : (
        <Button size="sm" onClick={onImport} disabled={disabledImport}>
          <UploadIcon />
          Import
        </Button>
      )}
      {!running && phase === "done" && (
        <Button variant="ghost" size="sm" onClick={onImportAnother}>
          <FileIcon />
          Import another
        </Button>
      )}
    </div>
  );
}
