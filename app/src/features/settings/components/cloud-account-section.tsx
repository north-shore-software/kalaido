import { useState } from "react";
import { openSystemBrowser } from "@/api/app/os-integrations.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/layout/section";
import { authClient } from "@/api/cloud/auth";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";

import { AccountCard } from "./account-card";
import { AuthForm } from "./auth-form";
import { OAuthButtons } from "./oauth-buttons";

export function CloudAccountSection() {
  const { session, isPending } = useCloudSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(input: {
    email: string;
    password: string;
    name?: string;
  }) {
    setLoading(true);
    setError(null);
    if (mode === "signin") {
      const { error: err } = await authClient.signIn.email({
        email: input.email,
        password: input.password,
      });
      if (err) setError(err.message ?? "Sign in failed");
    } else {
      const { error: err } = await authClient.signUp.email({
        email: input.email,
        password: input.password,
        name: input.name ?? "",
      });
      if (err) setError(err.message ?? "Sign up failed");
    }
    setLoading(false);
  }

  async function handleOAuth(provider: "google" | "github") {
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

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-32 w-full max-w-sm" />
      </div>
    );
  }

  if (session) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Cloud Account"
          description="Your account details."
        />
        <AccountCard
          name={session.user.name ?? ""}
          email={session.user.email}
          onSignOut={() => void signOutOfCloud()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Cloud Account"
        description="Sign in to sync your data across devices. Completely optional."
      />
      <AuthForm
        mode={mode}
        error={error}
        busy={loading}
        onSubmit={(input) => void handleEmailAuth(input)}
        onToggleMode={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
      />
      <div className="flex items-center gap-3 max-w-sm">
        <div className="flex-1 border-t" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 border-t" />
      </div>
      <OAuthButtons
        onProvider={(provider) => void handleOAuth(provider)}
        disabled={loading}
      />
    </div>
  );
}
