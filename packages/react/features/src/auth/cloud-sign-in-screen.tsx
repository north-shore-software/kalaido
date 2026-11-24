import { CloudAuthPanel } from "@kalaido/components/auth/cloud-auth-panel";
import { useCloudSession } from "@kalaido/hooks/use-cloud-session";
import type { Result } from "neverthrow";
import { useEffect } from "react";

export interface CloudSignInScreenProps {
  onSignedIn: () => void;
  onSyncWorkspaces: () => Promise<Result<void, Error>>;
}

export function CloudSignInScreen({
  onSignedIn,
  onSyncWorkspaces,
}: CloudSignInScreenProps) {
  const { signedIn, isPending } = useCloudSession();

  useEffect(() => {
    if (!isPending && signedIn) {
      onSignedIn();
    }
  }, [isPending, signedIn, onSignedIn]);

  if (isPending) {
    return null;
  }

  return (
    <div
      className="flex flex-col overflow-y-auto bg-background"
      style={{
        height: "var(--page-height, calc(100svh - var(--titlebar-height)))",
      }}
    >
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Sign in to Kalaido Cloud
        </h1>
        <CloudAuthPanel
          signInOnly
          onSyncWorkspaces={onSyncWorkspaces}
          onAuthenticated={onSignedIn}
        />
      </main>
    </div>
  );
}
