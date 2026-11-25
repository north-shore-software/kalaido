import { ConfirmDialog } from "@kalaido/primitives/kalaido";

interface DuplicateWorkspaceDialogProps {
  open: boolean;
  existingName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DuplicateWorkspaceDialog({
  open,
  existingName,
  busy,
  onConfirm,
  onCancel,
}: DuplicateWorkspaceDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title="Workspace Already Exists"
      description={`A local workspace named \u201c${existingName}\u201d already exists on this device. Would you like to restore this backup as a new copy?`}
      confirmLabel="Restore as New Copy"
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}
