import { ArrowLeftIcon, PlusIcon, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import { setSetting } from "@/api/app/settings.ts";
import { listCloudKalaidoscopes } from "@/api/cloud/user.ts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { upsertAvailableKalaidoscopes } from "@/hooks/app-state-actions.ts";
import { appState } from "@/hooks/use-app-state.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { cloudWorkspacesTransitions as transitions } from "./CloudWorkspaces.transitions";

export default function CloudWorkspaces() {
  const { go } = useAppNavigate();
  const { availableKalaidoscopes } = useSnapshot(appState);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);

    const result = await listCloudKalaidoscopes();
    if (result.isErr()) {
      setListError(result.error.message);
      setLoading(false);
      return;
    }

    upsertAvailableKalaidoscopes(result.value);
    await setSetting("availableKalaidoscopes", [
      ...appState.availableKalaidoscopes,
    ]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleOpen(id: string) {
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
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => go(transitions.back)}
          className="absolute top-4 left-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon />
          Back
        </Button>

        <header className="mt-12 flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Your cloud workspaces
            </h1>
            <p className="text-sm text-muted-foreground">
              Select a workspace to open, or create a new one.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => go(transitions.createWorkspace)}
          >
            <PlusIcon />
            Create New Workspace
          </Button>
        </header>

        {banner && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-xs text-destructive">{banner}</p>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {listError
              ? "Your cloud workspaces couldn't be loaded."
              : "You don't have any cloud workspaces yet."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => void handleOpen(workspace.id)}
                disabled={openingId !== null}
                className="flex h-28 flex-col items-start gap-3 rounded-lg border bg-card p-4 text-left ring-1 ring-foreground/5 transition-colors hover:border-foreground/30 hover:bg-surface-2 disabled:opacity-60"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border">
                  <span className="text-sm font-medium">
                    {workspace.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="line-clamp-2 text-sm font-medium">
                  {openingId === workspace.id
                    ? "Opening…"
                    : workspace.displayName}
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export const cloudWorkspacesRoute = defineRoute({
  id: "cloud-workspaces",
  path: "/onboarding/cloud",
  feature: "Onboarding",
  requiredScope: [],
  transitions,
  Component: CloudWorkspaces,
});
