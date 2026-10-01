import { useState, useTransition } from "react";
import useSWR from "swr";
import { downloadToFile } from "@/api/app/downloads.ts";
import { saveFilePicker } from "@/api/app/os-integrations.ts";
import type { KalaidoscopeMeta } from "@/api/app/types.ts";
import { activeClient } from "@/api/kalaidoscope/_active.ts";
import {
  type BackupSummary,
  backupDownloadUrl,
  createBackup,
  deleteBackup,
  listBackups,
} from "@/api/kalaidoscope/backups.ts";
import { kalaidoscopeAuthHeaders } from "@/api/kalaidoscope/client.ts";
import { Label, StatusPill } from "@/components/kalaido";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { restoreKalaidoscope } from "@/lib/restore-kalaidoscope.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(kind: BackupSummary["kind"]): string {
  switch (kind) {
    case "manual":
      return "Manual";
    case "scheduled":
      return "Scheduled";
    case "pre-restore":
      return "System / Safety Snapshot";
  }
}

export interface WorkspaceBackupsViewProps {
  description: string;
  backups: BackupSummary[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  onBackUp(): void;
  onRestore(id: string): void;
  onExport(id: string): void;
  onDelete(id: string): void;
}

export function WorkspaceBackupsView({
  description,
  backups,
  loading,
  busy,
  error,
  onBackUp,
  onRestore,
  onExport,
  onDelete,
}: WorkspaceBackupsViewProps) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col gap-0.5">
          <Label>Workspace backups</Label>
          <span className="text-body-sm text-fg-3">{description}</span>
        </div>
        <div className="flex-1" />
        <Button disabled={busy} onClick={onBackUp}>
          Back up now
        </Button>
      </div>

      {error && (
        <span role="alert" className="text-body text-critical-ink">
          {error}
        </span>
      )}

      {loading ? (
        <Spinner />
      ) : backups.length === 0 && !busy ? (
        <span className="text-body text-muted-foreground">
          No backups yet. Create one before making large changes.
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          {backups.map((backup) => (
            <div
              key={backup.id}
              className="flex flex-wrap items-center gap-2.5 text-body"
            >
              <StatusPill kind="cyan">{kindLabel(backup.kind)}</StatusPill>
              <span>{new Date(backup.created_at).toLocaleString()}</span>
              <span className="text-muted-foreground">
                {formatBytes(backup.size_bytes)}
              </span>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <Button
                  disabled={busy}
                  onClick={() => setRestoringId(backup.id)}
                >
                  Restore
                </Button>
                <Button disabled={busy} onClick={() => onExport(backup.id)}>
                  Export
                </Button>
                {deletingId === backup.id ? (
                  <>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        setDeletingId(null);
                        onDelete(backup.id);
                      }}
                    >
                      Yes, delete
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDeletingId(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => setDeletingId(backup.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!restoringId}
        onOpenChange={(open) => {
          if (!open) setRestoringId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Restore this workspace? A safety snapshot of your current state
              will be created, and your workspace will reload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (restoringId) {
                  const id = restoringId;
                  setRestoringId(null);
                  onRestore(id);
                }
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function WorkspaceBackupsPanel({
  kalaidoscope,
}: {
  kalaidoscope: KalaidoscopeMeta;
}) {
  const {
    data,
    error: swrError,
    isLoading,
    mutate,
  } = useSWR(["workspace-backups", kalaidoscope.id], async () => {
    const r = await listBackups();
    if (r.isErr()) throw r.error;
    return r.value;
  });

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const description =
    kalaidoscope.type === "cloud"
      ? "Snapshots of this workspace stored in Kalaido cloud."
      : "Snapshots of this workspace stored on this device.";

  function handleBackup() {
    startTransition(async () => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await createBackup();
        if (res.isErr()) {
          setActionError(res.error.message);
          return;
        }
        await mutate();
      } finally {
        setBusy(false);
      }
    });
  }

  async function handleRestore(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await restoreKalaidoscope(kalaidoscope, id);
      if (res.isErr()) {
        setActionError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      const pickRes = await saveFilePicker(
        `${kalaidoscope.displayName}-${id}`,
        [{ name: "Workspace backup", extensions: ["zip"] }],
      );
      if (pickRes.isErr()) {
        setActionError(pickRes.error.message);
        return;
      }
      const path = pickRes.value;
      if (!path) {
        return;
      }

      const clientRes = activeClient();
      if (clientRes.isErr()) {
        setActionError(clientRes.error.message);
        return;
      }
      const baseURL = clientRes.value.baseURL;
      const url = backupDownloadUrl(baseURL, id);
      const headers = await kalaidoscopeAuthHeaders(baseURL);
      const dlRes = await downloadToFile(url, headers, path);
      if (dlRes.isErr()) {
        setActionError(dlRes.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await deleteBackup(id);
      if (res.isErr()) {
        setActionError(res.error.message);
        return;
      }
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceBackupsView
      description={description}
      backups={data ?? []}
      loading={isLoading}
      busy={busy || isPending}
      error={actionError ?? (swrError ? swrError.message : null)}
      onBackUp={handleBackup}
      onRestore={(id) => void handleRestore(id)}
      onExport={(id) => void handleExport(id)}
      onDelete={(id) => void handleDelete(id)}
    />
  );
}
