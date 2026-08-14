import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Workspace Already Exists</AlertDialogTitle>
          <AlertDialogDescription>
            A local workspace named &ldquo;{existingName}&rdquo; already exists
            on this device. Would you like to restore this backup as a new copy?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy}>
            Restore as New Copy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
