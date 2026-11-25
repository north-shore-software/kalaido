import {
  type EmailCredentials,
  getCloudSessionToken,
  signInWithEmail,
  signUpWithEmail,
} from "@kalaido/client/cloud/auth";
import { CLOUD_SESSION_TAG } from "@kalaido/hooks/use-cloud-session";
import { CLOUD_WORKSPACES_TAG } from "@kalaido/hooks/use-cloud-workspaces";
import {
  type OptionCard,
  OptionCards,
} from "@kalaido/primitives/kalaido/option-cards";
import { cn } from "@kalaido/primitives/lib/css-utils";
import { useExternalWrite } from "@kalaido/state/live";
import { err, ok, type Result } from "neverthrow";
import { useState } from "react";
import { toast } from "sonner";
import { AuthForm } from "./auth-form";
import { OAuthButtons } from "./oauth-buttons";

export interface AuthOutcome {
  isNewAccount: boolean;
}

type AuthMode = "signin" | "signup";

export interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
  onSyncWorkspaces?: () => Promise<Result<void, Error>>;
  mode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  className?: string;
  signInOnly?: boolean;
}

const AUTH_MODES: OptionCard<AuthMode>[] = [
  { value: "signin", label: "Sign in", lines: ["Access existing workspaces"] },
  { value: "signup", label: "Sign up", lines: ["Create a new account"] },
];

export function CloudAuthPanel({
  onAuthenticated,
  onSyncWorkspaces,
  mode: controlledMode,
  onModeChange,
  className,
  signInOnly,
}: CloudAuthPanelProps) {
  const [internalMode, setInternalMode] = useState<AuthMode>("signin");
  const [errorMode, setErrorMode] = useState<AuthMode | null>(null);
  const mode = signInOnly ? "signin" : (controlledMode ?? internalMode);
  const setMode = onModeChange ?? setInternalMode;

  const authWrite = useExternalWrite<
    { mode: AuthMode; credentials: EmailCredentials },
    void
  >({
    execute: async ({ mode: submitMode, credentials }) => {
      const res =
        submitMode === "signin"
          ? await signInWithEmail(credentials)
          : await signUpWithEmail(credentials);
      if (res.isErr()) return err(res.error);

      if (onSyncWorkspaces) {
        const synced = await onSyncWorkspaces();
        if (synced.isErr()) {
          if (getCloudSessionToken().isErr()) {
            return err(synced.error);
          }
          toast.error("Couldn't sync cloud workspaces", {
            description: synced.error.message,
          });
        }
      }

      return ok(undefined);
    },
    concurrency: "ignore",
    invalidates: [CLOUD_SESSION_TAG, CLOUD_WORKSPACES_TAG],
  });

  function handleModeChange(next: AuthMode) {
    authWrite.reset();
    setErrorMode(null);
    setMode(next);
  }

  async function handleSubmit(credentials: EmailCredentials) {
    const submitMode = mode;
    setErrorMode(submitMode);
    const outcome = await authWrite.run({ mode: submitMode, credentials });
    if (outcome.status === "success") {
      setErrorMode(null);
      onAuthenticated?.({ isNewAccount: submitMode === "signup" });
    }
  }

  const error =
    errorMode === mode && authWrite.error ? authWrite.error.message : null;

  return (
    <div className={cn("flex w-full max-w-lg flex-col gap-6", className)}>
      {!signInOnly && (
        <OptionCards
          options={AUTH_MODES}
          value={mode}
          onChange={handleModeChange}
          disabled={authWrite.isPending}
        />
      )}

      <AuthForm
        mode={mode}
        error={error}
        busy={authWrite.isPending}
        onSubmit={(input) => void handleSubmit(input)}
      />

      {!signInOnly && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t" />
            <span className="font-mono text-meta uppercase text-muted-foreground">
              or
            </span>
            <div className="flex-1 border-t" />
          </div>

          <OAuthButtons />
        </>
      )}
    </div>
  );
}
