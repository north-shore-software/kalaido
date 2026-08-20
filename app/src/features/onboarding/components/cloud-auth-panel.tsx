import { useState } from "react";
import { authClient } from "@/api/cloud/auth";
import { type OptionCard, OptionCards } from "@/components/kalaido";
import { AuthForm } from "@/features/settings/components/auth-form";
import { OAuthButtons } from "@/features/settings/components/oauth-buttons";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";

export interface AuthOutcome {
  /** True when this was a registration rather than a returning sign-in. */
  isNewAccount: boolean;
}

interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
}

const AUTH_MODES: OptionCard<"signin" | "signup">[] = [
  { value: "signin", label: "Sign in", lines: ["Access existing workspaces"] },
  { value: "signup", label: "Sign up", lines: ["Create a new account"] },
];

export function CloudAuthPanel({ onAuthenticated }: CloudAuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(input: { email: string; password: string }) {
    setBusy(true);
    setError(null);

    const { error: err } =
      mode === "signin"
        ? await authClient.signIn.email({
            email: input.email,
            password: input.password,
          })
        : await authClient.signUp.email({
            email: input.email,
            password: input.password,
            name: "",
          });

    if (err) {
      setBusy(false);
      setError(
        err.message ??
          (mode === "signin" ? "Sign in failed" : "Sign up failed"),
      );
      return;
    }

    await syncCloudWorkspaces();

    setBusy(false);
    onAuthenticated?.({ isNewAccount: mode === "signup" });
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <OptionCards
        options={AUTH_MODES}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(null);
        }}
        disabled={busy}
      />

      <AuthForm
        mode={mode}
        error={error}
        busy={busy}
        onSubmit={(input) => void handleEmailAuth(input)}
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
