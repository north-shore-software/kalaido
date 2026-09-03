import { SectionHeader } from "@/components/layout/section";
import { Skeleton } from "@/components/ui/skeleton";
import { CloudAuthPanel } from "@/features/onboarding/components/cloud-auth-panel";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { signOutOfCloud } from "@/lib/cloud-sign-out.ts";

import { AccountCard } from "./account-card";

export function CloudAccountSection() {
  const { session, isPending } = useCloudSession();

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
      {/*
        Same panel as onboarding, so the sign-in/sign-up toggle behaves
        identically in both places rather than drifting into two forms with the
        same job.

        No `onAuthenticated` handler: the panel has already restored the
        account's workspaces by the time it fires, and this section swaps itself
        for the account card on its own because `authClient.useSession()` is
        reactive. Signing up here must never navigate — you came to Settings to
        do something, and a redirect to workspace setup would abandon it.
      */}
      <CloudAuthPanel />
    </div>
  );
}
