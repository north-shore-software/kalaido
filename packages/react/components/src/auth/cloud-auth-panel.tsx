import {
  type EmailCredentials,
  getCloudSessionToken,
  signInWithEmail,
  signUpWithEmail,
} from "@kalaido/client/cloud/auth";
import {
  type OptionCard,
  OptionCards,
} from "@kalaido/primitives/kalaido/option-cards";
import { cn } from "@kalaido/primitives/lib/css-utils";
import type { Result } from "neverthrow";
import { startTransition, useActionState, useState } from "react";
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

type AuthFailure = { mode: AuthMode; message: string } | null;

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
  const mode = signInOnly ? "signin" : (controlledMode ?? internalMode);
  const setMode = onModeChange ?? setInternalMode;

  const [failure, submit, busy] = useActionState(
    async (
      _prev: AuthFailure,
      input: EmailCredentials,
    ): Promise<AuthFailure> => {
      const res =
        mode === "signin"
          ? await signInWithEmail(input)
          : await signUpWithEmail(input);
      if (res.isErr()) return { mode, message: res.error.message };

      if (onSyncWorkspaces) {
        const synced = await onSyncWorkspaces();
        if (synced.isErr()) {
          if (getCloudSessionToken().isErr()) {
            return { mode, message: synced.error.message };
          }
          toast.error("Couldn't sync cloud workspaces", {
            description: synced.error.message,
          });
        }
      }

      onAuthenticated?.({ isNewAccount: mode === "signup" });

      return null;
    },
    null,
  );
  const error = failure?.mode === mode ? failure.message : null;

  return (
    <div className={cn("flex w-full max-w-lg flex-col gap-6", className)}>
      {!signInOnly && (
        <OptionCards
          options={AUTH_MODES}
          value={mode}
          onChange={setMode}
          disabled={busy}
        />
      )}

      <AuthForm
        mode={mode}
        error={error}
        busy={busy}
        onSubmit={(input) => startTransition(() => submit(input))}
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
