import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FilePickerProps {
  path?: string;
  disabled?: boolean;
  onChoose: () => void;
}

export function FilePicker({ path, disabled, onChoose }: FilePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        value={path || ""}
        readOnly
        placeholder="No file selected"
        onClick={onChoose}
        className="flex-1 cursor-pointer font-mono text-sm"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="shrink-0"
        onClick={onChoose}
        disabled={disabled}
        aria-label="Choose file"
      >
        <FolderOpenIcon />
      </Button>
    </div>
  );
}
