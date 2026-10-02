import { WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { appState } from "@/hooks/use-app-state.ts";
import { useCloudSession } from "@/hooks/use-cloud-session";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { useAppNavigate } from "@/routes/use-app-navigate";

export default function CloudWorkspacePicker() {
  const { goBack } = useAppNavigate();
  const { user } = useCloudSession();
  const { availableKalaidoscopes } = useSnapshot(appState);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(() =>
    appState.appStage.stage === "kalaidoscope_load_error"
      ? (appState.appStage.error?.message ?? null)
      : null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const result = await syncCloudWorkspaces();
    if (result.isErr()) setListError(result.error.message);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleOpen(id: string) {
    if (
      appState.appStage.stage === "kalaidoscope_open" &&
      appState.appStage.selectedKalaidoscopeId === id
    ) {
      goBack();
      return;
    }
    setOpeningId(id);
    setOpenError(null);
    const result = await switchLocalKalaidoscope(id, { surfaceError: false });
    if (result.isErr()) setOpenError(result.error.message);
    setOpeningId(null);
  }

  const workspaces = availableKalaidoscopes.filter((k) => k.type === "cloud");
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
              onClick={() => void signOutOfCloud()}
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
        ) : !listError && workspaces.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No cloud workspaces yet. Create one from the desktop app.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {workspaces.map((workspace) => (
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
