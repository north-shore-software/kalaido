import { activeKalaidoscopes } from "@kalaido/client/lib/active-kalaidoscopes";
import { useCloudSession } from "@kalaido/hooks/use-cloud-session";
import type { KalaidoscopeMeta } from "@kalaido/platform";
import { Button } from "@kalaido/primitives/shadcn/button";
import { Skeleton } from "@kalaido/primitives/shadcn/skeleton";
import { WarningIcon } from "@phosphor-icons/react";
import type { Result } from "neverthrow";
import { useCallback, useEffect, useState } from "react";

export interface CloudWorkspacePickerScreenProps {
  workspaces: readonly KalaidoscopeMeta[];
  activeWorkspaceId: string | null;
  initialError?: string | null;
  onSyncWorkspaces: () => Promise<Result<void, Error>>;
  onOpenWorkspace: (id: string) => Promise<Result<void, Error>>;
  onAlreadyOpen: () => void;
  onSignOut: () => Promise<void>;
}

export function CloudWorkspacePickerScreen({
  workspaces,
  activeWorkspaceId,
  initialError = null,
  onSyncWorkspaces,
  onOpenWorkspace,
  onAlreadyOpen,
  onSignOut,
}: CloudWorkspacePickerScreenProps) {
  const { user } = useCloudSession();
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(initialError);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const result = await onSyncWorkspaces();
    if (result.isErr()) setListError(result.error.message);
    setLoading(false);
  }, [onSyncWorkspaces]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleOpen(id: string) {
    if (activeWorkspaceId === id) {
      onAlreadyOpen();
      return;
    }
    setOpeningId(id);
    setOpenError(null);
    const result = await onOpenWorkspace(id);
    if (result.isErr()) setOpenError(result.error.message);
    setOpeningId(null);
  }

  const cloudWorkspaces = activeKalaidoscopes(workspaces).filter(
    (k) => k.type === "cloud",
  );
  const banner = openError ?? listError;

  return (
    <div
      className="flex flex-col overflow-y-auto bg-background"
      style={{
        height: "var(--page-height, calc(100svh - var(--titlebar-height)))",
      }}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Your cloud workspaces
          </h1>
          <div className="flex items-center gap-2 text-muted-foreground">
            {user?.email && <span>{user.email}</span>}
            <button
              type="button"
              className="text-meta text-muted-foreground hover:text-foreground"
              onClick={() => void onSignOut()}
            >
              Sign out
            </button>
          </div>
        </header>

        {banner && (
          <div className="flex items-start gap-3 rounded-none border border-destructive/40 bg-destructive/5 p-3">
            <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-meta text-destructive">{banner}</p>
            {listError && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
              >
                Retry
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full rounded-none" />
            <Skeleton className="h-14 w-full rounded-none" />
            <Skeleton className="h-14 w-full rounded-none" />
          </div>
        ) : !listError && cloudWorkspaces.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No cloud workspaces yet. Create one from the desktop app.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {cloudWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => void handleOpen(workspace.id)}
                disabled={openingId !== null}
                className="flex h-14 w-full items-center rounded-none border bg-card px-4 text-left text-item font-medium disabled:opacity-60"
              >
                {openingId === workspace.id
                  ? "Opening…"
                  : workspace.displayName}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
