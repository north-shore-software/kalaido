import { useState } from "react";
import { openSystemBrowser } from "@/api/app/os-integrations.ts";
import { authClient } from "@/api/cloud/auth";
import { Segmented } from "@/components/kalaido";
import { AuthForm } from "@/features/settings/components/auth-form";
import { OAuthButtons } from "@/features/settings/components/oauth-buttons";

const MODE_LABELS = ["Sign in", "Sign up"] as const;
type ModeLabel = (typeof MODE_LABELS)[number];

export interface AuthOutcome {
  /** True when this was a registration rather than a returning sign-in. */
  isNewAccount: boolean;
}

interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
}

export function CloudAuthPanel({ onAuthenticated }: CloudAuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(input: {
    email: string;
    password: string;
    name?: string;
  }) {
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
            name: input.name ?? "",
          });

    setBusy(false);

    if (err) {
      setError(
        err.message ??
          (mode === "signin" ? "Sign in failed" : "Sign up failed"),
      );
      return;
    }

    onAuthenticated?.({ isNewAccount: mode === "signup" });
  }

  async function handleOAuth(provider: "google" | "github") {
    setError(null);
    const { data, error: err } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
    if (err) {
      setError(err.message ?? "OAuth failed");
      return;
    }
    if (data?.url) await openSystemBrowser(data.url);
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
        onToggleMode={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
      />

      <div className="flex max-w-sm items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 border-t" />
      </div>

      <OAuthButtons
        onProvider={(provider) => void handleOAuth(provider)}
        disabled={busy}
      />
    </div>
  );
}
