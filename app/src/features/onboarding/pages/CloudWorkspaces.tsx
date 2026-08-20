import { PlusIcon, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio/react";
import { Mark } from "@/components/kalaido";
import { PageBackButton } from "@/components/layout/page-back-button";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { KalaidoscopeSetupState } from "@/features/create-kalaidoscope/types";
import { appState } from "@/hooks/use-app-state.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";
import { switchLocalKalaidoscope } from "@/lib/local-kalaidoscope.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { cloudWorkspacesTransitions as transitions } from "./CloudWorkspaces.transitions";

const CREATE_CLOUD_WORKSPACE: KalaidoscopeSetupState = {
  defaultStorage: "cloud",
};

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

    const result = await syncCloudWorkspaces();
    if (result.isErr()) setListError(result.error.message);

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

  // Only a confirmed-empty account gets the hero. A failed list is also
  // zero-length, and dressing that up as "create your first" would tell an
  // offline user their workspaces don't exist.
  const isEmpty = !loading && !listError && workspaces.length === 0;

  return (
    <div
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
        <PageBackButton onClick={() => go(transitions.back)} />

        <header className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Your cloud workspaces
            </h1>
            <p className="text-body-sm text-muted-foreground">
              Select a workspace to open, or create a new one.
            </p>
          </div>
          {!isEmpty && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() =>
                go(transitions.createWorkspace, {
                  state: CREATE_CLOUD_WORKSPACE,
                })
              }
            >
              <PlusIcon />
              Create New Workspace
            </Button>
          )}
        </header>

        {banner && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : isEmpty ? (
          <Empty className="rounded-lg border">
            <EmptyHeader>
              <EmptyMedia>
                <Mark className="size-10" />
              </EmptyMedia>
              <EmptyTitle>No cloud workspaces yet</EmptyTitle>
              <EmptyDescription>
                Create one to sync your work across every device you sign in on.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                className="gap-1.5"
                onClick={() =>
                  go(transitions.createWorkspace, {
                    state: CREATE_CLOUD_WORKSPACE,
                  })
                }
              >
                <PlusIcon />
                Create New Workspace
              </Button>
              <button
                type="button"
                className="text-meta text-muted-foreground hover:text-foreground"
                onClick={() => void signOutOfCloud()}
              >
                Not you? Sign out
              </button>
            </EmptyContent>
          </Empty>
        ) : workspaces.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            Your cloud workspaces couldn&apos;t be loaded.
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
                  <span className="text-item font-medium">
                    {workspace.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="line-clamp-2 text-item font-medium">
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
