import { startTransition, useActionState, useState } from "react";
import {
  type EmailCredentials,
  signInWithEmail,
  signUpWithEmail,
} from "@/api/cloud/auth";
import { type OptionCard, OptionCards } from "@/components/kalaido";
import { AuthForm } from "@/features/settings/components/auth-form";
import { OAuthButtons } from "@/features/settings/components/oauth-buttons";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";
import { cn } from "@/lib/css-utils";

export interface AuthOutcome {
  /** True when this was a registration rather than a returning sign-in. */
  isNewAccount: boolean;
}

type AuthMode = "signin" | "signup";

interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
  mode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  className?: string;
}

/** A failed attempt, remembered with the mode it happened in. */
type AuthFailure = { mode: AuthMode; message: string } | null;

const AUTH_MODES: OptionCard<AuthMode>[] = [
  { value: "signin", label: "Sign in", lines: ["Access existing workspaces"] },
  { value: "signup", label: "Sign up", lines: ["Create a new account"] },
];

export function CloudAuthPanel({
  onAuthenticated,
  mode: controlledMode,
  onModeChange,
  className,
}: CloudAuthPanelProps) {
  const [internalMode, setInternalMode] = useState<AuthMode>("signin");
  const mode = controlledMode ?? internalMode;
  const setMode = onModeChange ?? setInternalMode;

  // React owns the pending flag: it is on for exactly the life of the action,
  // whether that returns, throws or is superseded.
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

      // The account is in; a stale workspace list is not worth blocking on.
      const synced = await syncCloudWorkspaces();
      if (synced.isErr()) {
        console.error(
          "Cloud workspace sync after sign-in failed:",
          synced.error,
        );
      }

      onAuthenticated?.({ isNewAccount: mode === "signup" });
      return null;
    },
    null,
  );
  // A failure belongs to the tab it happened on; switching tabs puts it away.
  const error = failure?.mode === mode ? failure.message : null;

  return (
    <div className={cn("flex w-full max-w-lg flex-col gap-6", className)}>
      <OptionCards
        options={AUTH_MODES}
        value={mode}
        onChange={setMode}
        disabled={busy}
      />

      <AuthForm
        mode={mode}
        error={error}
        busy={busy}
        // Outside a <form action>, an action only counts as pending when it is
        // dispatched inside a transition.
        onSubmit={(input) => startTransition(() => submit(input))}
      />

      <div className="flex items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="font-mono text-meta uppercase text-muted-foreground">
          or
        </span>
        <div className="flex-1 border-t" />
      </div>

      <OAuthButtons />
    </div>
  );
}
