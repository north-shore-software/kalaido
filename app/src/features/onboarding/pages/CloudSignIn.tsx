import { useEffect } from "react";
import { useCloudSession } from "@/hooks/use-cloud-session";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { CloudAuthPanel } from "../components/cloud-auth-panel";
import { cloudSignInTransitions } from "./CloudSignIn.transitions";

export default function CloudSignIn() {
  const { signedIn, isPending } = useCloudSession();
  const { go } = useAppNavigate();

  useEffect(() => {
    if (!isPending && signedIn) {
      go(cloudSignInTransitions.signedIn, { replace: true });
    }
  }, [isPending, signedIn, go]);

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
          onAuthenticated={() =>
            go(cloudSignInTransitions.signedIn, { replace: true })
          }
        />
      </main>
    </div>
  );
}
