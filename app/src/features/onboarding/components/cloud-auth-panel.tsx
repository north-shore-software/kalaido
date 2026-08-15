import { useState } from "react";
import { authClient } from "@/api/cloud/auth";
import { Segmented } from "@/components/kalaido";
import { AuthForm } from "@/features/settings/components/auth-form";
import { OAuthButtons } from "@/features/settings/components/oauth-buttons";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";

const MODE_LABELS = ["Sign in", "Sign up"] as const;
type ModeLabel = (typeof MODE_LABELS)[number];

export interface AuthOutcome {
  /** True when this was a registration rather than a returning sign-in. */
  isNewAccount: boolean;
}

interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
}

/**
 * The one place email/password auth is composed, shared by onboarding and
 * Settings. Mode is owned by the `<Segmented>` control above the form, which is
 * why {@link AuthForm} has no toggle of its own.
 *
 * What happens *after* a successful auth is the caller's to decide — this panel
 * only restores the account's workspaces, which every caller wants, and then
 * hands over. Onboarding routes a new account onward to workspace setup;
 * Settings stays exactly where it is.
 */
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
            // Accounts are identified by email; there is no name to collect.
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

    // Whatever the caller does next, the account's workspaces have to be in
    // app state for the switcher and the cloud list to be right. A brand-new
    // account has none, and a failure here is not worth blocking auth over —
    // the cloud list surfaces its own load errors.
    await syncCloudWorkspaces();

    setBusy(false);
    onAuthenticated?.({ isNewAccount: mode === "signup" });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Segmented<ModeLabel>
        items={MODE_LABELS}
        value={mode === "signin" ? "Sign in" : "Sign up"}
        onChange={(label) => {
          setMode(label === "Sign in" ? "signin" : "signup");
          setError(null);
        }}
        className="self-start"
      />

      <AuthForm
        mode={mode}
        error={error}
        busy={busy}
        onSubmit={(input) => void handleEmailAuth(input)}
      />

      <div className="flex max-w-sm items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 border-t" />
      </div>

      <OAuthButtons />
    </div>
  );
}
