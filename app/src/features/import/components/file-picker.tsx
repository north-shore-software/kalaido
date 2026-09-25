import { FolderOpenIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FilePickerProps {
  path?: string;
  disabled?: boolean;
  onChoose: () => void;
}

export function FilePicker({ path, disabled, onChoose }: FilePickerProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Input
        value={path || ""}
        readOnly
        placeholder="No file selected"
        onClick={onChoose}
        className="w-full min-w-0 flex-1 cursor-pointer font-mono text-body-sm border border-line bg-surface-1 px-3 py-2 hover:border-fg-3 focus-visible:border-cyan"
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
