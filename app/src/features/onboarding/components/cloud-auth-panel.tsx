import { useState } from "react";
import { authClient } from "@/api/cloud/auth";
import { AuthForm } from "@/features/settings/components/auth-form";
import { OAuthButtons } from "@/features/settings/components/oauth-buttons";
import { syncCloudWorkspaces } from "@/lib/cloud-workspaces.ts";
import { cn } from "@/lib/css-utils";

export interface AuthOutcome {
  /** True when this was a registration rather than a returning sign-in. */
  isNewAccount: boolean;
}

interface CloudAuthPanelProps {
  onAuthenticated?: (outcome: AuthOutcome) => void;
}

const AUTH_MODES = [
  { value: "signin", label: "Sign in", desc: "Access existing workspaces" },
  { value: "signup", label: "Sign up", desc: "Create a new account" },
] as const;

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
      <div role="radiogroup" className="grid grid-cols-2 gap-3">
        {AUTH_MODES.map((tab) => {
          const isSelected = mode === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={busy}
              onClick={() => {
                setMode(tab.value);
                setError(null);
              }}
              className={cn(
                "flex min-h-[96px] cursor-pointer flex-col justify-center gap-1 rounded-lg border p-4 text-left transition-all duration-150",
                isSelected
                  ? "border-cyan-edge bg-cyan-veil shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                  : "border-dashed hover:border-foreground/30 hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "text-item font-semibold",
                  isSelected ? "text-cyan" : "text-foreground",
                )}
              >
                {tab.label}
              </span>
              <p className="text-body-sm leading-relaxed text-fg-3">
                {tab.desc}
              </p>
            </button>
          );
        })}
      </div>

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
