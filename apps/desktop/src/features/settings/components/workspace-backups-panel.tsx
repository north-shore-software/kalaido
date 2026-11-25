import { activeClient } from "@kalaido/client/kalaidoscope/_active";
import {
  type BackupSummary,
  backupDownloadUrl,
  createBackup,
  deleteBackup,
  listBackups,
} from "@kalaido/client/kalaidoscope/backups";
import { kalaidoscopeAuthHeaders } from "@kalaido/client/kalaidoscope/client";
import { kalaidoscopeEndpointTag } from "@kalaido/hooks/kalaidoscope-live";
import { useKalaidoscopeClient } from "@kalaido/hooks/use-kalaidoscope-client";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { ConfirmDialog, Label, StatusPill } from "@kalaido/primitives/kalaido";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Spinner } from "@kalaido/primitives/shadcn/spinner";
import {
  httpLiveSource,
  useExternalWrite,
  useLiveRead,
} from "@kalaido/state/live";
import { useMemo, useState } from "react";
import { downloadToFile } from "@/api/app/downloads.ts";
import { saveFilePicker } from "@/api/app/os-integrations.ts";
import { restoreKalaidoscope } from "@/lib/restore-kalaidoscope.ts";

const BACKUPS_ENDPOINT = "backups";

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

      <ConfirmDialog
        open={!!restoringId}
        onOpenChange={(open) => {
          if (!open) setRestoringId(null);
        }}
        title="Restore workspace"
        description="Restore this workspace? A safety snapshot of your current state will be created, and your workspace will reload."
        confirmLabel="Restore"
        busy={busy}
        onConfirm={() => {
          if (restoringId) {
            const id = restoringId;
            setRestoringId(null);
            onRestore(id);
          }
        }}
      />
    </div>
  );
}

function sanitizeExportName(displayName: string, fallbackId: string): string {
  const sanitized = displayName
    // biome-ignore lint/suspicious/noControlCharactersInRegex: sanitize control characters for filesystem safety
    .replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^-+|-+$/g, "");

  return sanitized || fallbackId;
}

export function WorkspaceBackupsPanel({
  kalaidoscope,
}: {
  kalaidoscope: KalaidoscopeMeta;
}) {
  const client = useKalaidoscopeClient();
  const backupsTag = kalaidoscopeEndpointTag(client.baseURL, BACKUPS_ENDPOINT);

  const source = useMemo(
    () =>
      httpLiveSource<BackupSummary[]>({
        key: ["pb", client.baseURL, BACKUPS_ENDPOINT],
        tags: [backupsTag],
        fetch: listBackups,
      }),
    [client.baseURL, backupsTag],
  );
  const { data, error: loadError, isLoading } = useLiveRead(source);

  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const backupWrite = useExternalWrite<void, { readonly id: string }>({
    execute: async () => (await createBackup()).map((b) => ({ id: b.id })),
    concurrency: "ignore",
    invalidates: () => [backupsTag],
  });

  const restoreWrite = useExternalWrite<string, void>({
    execute: (id) => restoreKalaidoscope(kalaidoscope, id),
    concurrency: "ignore",
    invalidates: () => [backupsTag],
  });

  const deleteWrite = useExternalWrite<string, void>({
    execute: (id) => deleteBackup(id),
    concurrency: "ignore",
    invalidates: () => [backupsTag],
  });

  const busy =
    backupWrite.isPending ||
    restoreWrite.isPending ||
    deleteWrite.isPending ||
    exporting;

  const description =
    kalaidoscope.type === "cloud"
      ? "Snapshots of this workspace stored in Kalaido cloud."
      : "Snapshots of this workspace stored on this device.";

  async function handleBackup() {
    if (busy) return;
    setActionError(null);
    const outcome = await backupWrite.run();
    if (outcome.status === "error") {
      setActionError(outcome.error.message);
    }
  }

  async function handleRestore(id: string) {
    if (busy) return;
    setActionError(null);
    const outcome = await restoreWrite.run(id);
    if (outcome.status === "error") {
      setActionError(outcome.error.message);
    }
  }

  async function handleExport(id: string) {
    if (busy) return;
    setExporting(true);
    setActionError(null);
    try {
      const baseName = sanitizeExportName(
        kalaidoscope.displayName,
        kalaidoscope.id,
      );
      const pickRes = await saveFilePicker(`${baseName}-${id}`, [
        { name: "Workspace backup", extensions: ["zip"] },
      ]);
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
      setExporting(false);
    }
  }

  async function handleDelete(id: string) {
    if (busy) return;
    setActionError(null);
    const outcome = await deleteWrite.run(id);
    if (outcome.status === "error") {
      setActionError(outcome.error.message);
    }
  }

  return (
    <WorkspaceBackupsView
      description={description}
      backups={data ?? []}
      loading={isLoading}
      busy={busy}
      error={actionError ?? (loadError ? loadError.message : null)}
      onBackUp={() => void handleBackup()}
      onRestore={(id) => void handleRestore(id)}
      onExport={(id) => void handleExport(id)}
      onDelete={(id) => void handleDelete(id)}
    />
  );
}
