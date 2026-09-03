import { FileIcon, UploadIcon } from "lucide-react";
import type { IngestPhase } from "@/api/kalaidoscope/ingest";
import { Button } from "@/components/ui/button";

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
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      ) : phase === "done" ? (
        <Button
          variant="section"
          className="bg-lime text-[#16171a] hover:text-[#16171a]"
          onClick={onViewStream}
        >
          View in stream
        </Button>
      ) : (
        <Button
          variant="section"
          className="bg-lime text-[#16171a] hover:text-[#16171a]"
          onClick={onImport}
          disabled={disabledImport}
        >
          <UploadIcon />
          Import
        </Button>
      )}
      {!running && phase === "done" && (
        <Button variant="ghost" onClick={onImportAnother}>
          <FileIcon />
          Import another
        </Button>
      )}
    </div>
  );
}
