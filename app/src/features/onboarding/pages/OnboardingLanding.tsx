import {
  ArchiveIcon,
  CloudIcon,
  FolderInputIcon,
  PlusIcon,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useSnapshot } from "valtio/react";
import { openFilePicker } from "@/api/app/os-integrations.ts";
import type { WorkspaceLlmConfig } from "@/api/kalaidoscope/llm-config.ts";
import { Button } from "@/components/ui/button";
import { createKalaidoscope } from "@/features/create-kalaidoscope/actions.ts";
import { KalaidoscopeList } from "@/features/create-kalaidoscope/components/kalaidoscope-list";
import { appState } from "@/hooks/use-app-state.ts";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import type { KalaidoscopeSetupState } from "@/features/create-kalaidoscope/types";
import { PrimaryChoice, SecondaryChoice } from "../components/choice-cards";
import { DuplicateWorkspaceDialog } from "../components/duplicate-workspace-dialog";
import { OnboardingShell } from "../components/onboarding-shell";
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

  const importState: KalaidoscopeSetupState = { intent: "import" };

  return (
    <>
      <OnboardingShell
        title="Get started with Kalaido"
        description="Choose how you'd like to set up a workspace."
      >
        {restoreError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="flex-1 text-meta text-destructive">{restoreError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRestoreError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <PrimaryChoice
            icon={<FolderInputIcon className="size-6" />}
            title="Import your notes"
            description="Bring in documents, notes or an email archive and let Kalaido organise them."
            onClick={() =>
              go(transitions.createForImport, { state: importState })
            }
          />
          <SecondaryChoice
            icon={<PlusIcon className="size-4" />}
            title="Start from blank"
            description="An empty local or cloud workspace."
            onClick={() => go(transitions.createWorkspace)}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <SecondaryChoice
              icon={<CloudIcon className="size-4" />}
              title={
                signedIn ? "Signed in to Kalaido Cloud" : "Log in to Cloud"
              }
              description={
                signedIn
                  ? (user?.email ?? "View cloud workspaces.")
                  : "Access cloud workspaces and sync across devices."
              }
              onClick={() =>
                go(
                  signedIn
                    ? transitions.viewCloudWorkspaces
                    : transitions.logIn,
                )
              }
            />
            <SecondaryChoice
              icon={<ArchiveIcon className="size-4" />}
              title="Restore Workspace"
              description="Restore a workspace backup from a .zip file."
              disabled={restoring}
              onClick={() => void handleRestore()}
            />
          </div>
        </div>

        {availableKalaidoscopes.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-6">
            <span className="text-label uppercase text-muted-foreground">
              Your workspaces
            </span>
            <KalaidoscopeList className="flex flex-col" />
          </section>
        )}
      </OnboardingShell>

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
    </>
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
