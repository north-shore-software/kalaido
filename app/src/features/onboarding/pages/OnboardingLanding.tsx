import {
  ArrowRight,
  ArchiveIcon,
  CloudIcon,
  PlusIcon,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useSnapshot } from "valtio/react";
import { openFilePicker } from "@/api/app/os-integrations.ts";
import type { WorkspaceLlmConfig } from "@/api/kalaidoscope/llm-config.ts";
import { Mark } from "@/components/kalaido";
import { Button } from "@/components/ui/button";
import { createKalaidoscope } from "@/features/create-kalaidoscope/actions.ts";
import { KalaidoscopeList } from "@/features/create-kalaidoscope/components/kalaidoscope-list";
import { appState } from "@/hooks/use-app-state.ts";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { DuplicateWorkspaceDialog } from "../components/duplicate-workspace-dialog";
import { RestoreProviderDialog } from "../components/restore-provider-dialog";
import { inspectWorkspaceArchive, type RestoreInspection } from "../restore";
import { onboardingLandingTransitions as transitions } from "./OnboardingLanding.transitions";

export default function OnboardingLanding() {
  const { go } = useAppNavigate();
  const { user, signedIn } = useCloudSession();
  const { availableKalaidoscopes } = useSnapshot(appState);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<RestoreInspection | null>(null);

  async function completeRestore(
    suggestedName: string,
    llmConfig?: WorkspaceLlmConfig,
  ) {
    setRestoring(true);
    const result = await createKalaidoscope({
      name: suggestedName,
      storage: "local_file",
      cloudId: "",
      locationInput: "",
      llmConfig,
    });
    if (result.isErr()) {
      setRestoreError(result.error.message);
      setRestoring(false);
    }
    setPending(null);
  }

  async function handleRestore() {
    setRestoreError(null);

    const picked = await openFilePicker([
      { name: "Workspace backup", extensions: ["zip"] },
    ]);
    if (picked.isErr()) {
      setRestoreError(picked.error.message);
      return;
    }
    if (!picked.value) return;

    setRestoring(true);
    const inspected = await inspectWorkspaceArchive(picked.value);
    setRestoring(false);

    if (inspected.isErr()) {
      setRestoreError(inspected.error.message);
      return;
    }

    if (inspected.value.kind === "ready") {
      await completeRestore(inspected.value.suggestedName);
      return;
    }

    setPending(inspected.value);
  }

  return (
    <div
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
        <header className="flex flex-col gap-2">
          <Mark className="size-8" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Get started with Kalaido
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose how you&apos;d like to set up your workspace.
          </p>
        </header>

        {restoreError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-xs text-destructive">{restoreError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRestoreError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        <PrimaryChoice
          icon={<PlusIcon className="size-6" />}
          title="Create New Workspace"
          description="Start fresh with a brand new local or cloud workspace."
          onClick={() => go(transitions.createWorkspace)}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SecondaryChoice
            icon={<CloudIcon className="size-4" />}
            title={signedIn ? "Signed in to Kalaido Cloud" : "Log in to Cloud"}
            description={
              signedIn
                ? (user?.email ?? "View your cloud workspaces.")
                : "Access your existing cloud workspaces and sync across devices."
            }
            onClick={() =>
              go(signedIn ? transitions.viewCloudWorkspaces : transitions.logIn)
            }
          />
          <SecondaryChoice
            icon={<ArchiveIcon className="size-4" />}
            title="Restore Workspace"
            description="Restore a whole-workspace backup from a .zip archive file."
            disabled={restoring}
            onClick={() => void handleRestore()}
          />
        </div>

        {availableKalaidoscopes.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-6">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your workspaces
            </span>
            <KalaidoscopeList className="flex flex-col" />
          </section>
        )}
      </main>

      <DuplicateWorkspaceDialog
        open={pending?.kind === "collision"}
        existingName={pending?.kind === "collision" ? pending.existingName : ""}
        busy={restoring}
        onConfirm={() => {
          if (pending?.kind === "collision") {
            void completeRestore(pending.suggestedName);
          }
        }}
        onCancel={() => setPending(null)}
      />

      <RestoreProviderDialog
        open={pending?.kind === "needsKey"}
        onConfirm={(config) => {
          if (pending?.kind === "needsKey") {
            void completeRestore(pending.suggestedName, config);
          }
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

interface ChoiceProps {
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

function PrimaryChoice({ icon, title, description, onClick }: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-lg border bg-card p-5 text-left ring-1 ring-foreground/5 transition-colors hover:border-foreground/30 hover:bg-surface-2"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function SecondaryChoice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex items-start gap-3 rounded-lg border border-dashed p-4 text-left transition-colors hover:border-foreground/30 hover:bg-surface-2 disabled:opacity-60"
    >
      <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export const onboardingLandingRoute = defineRoute({
  id: "onboarding-landing",
  path: "/onboarding",
  feature: "Onboarding",
  requiredScope: [],
  transitions,
  Component: OnboardingLanding,
});
