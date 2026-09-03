import { useEffect, useRef, useState } from "react";
import { PageBackButton } from "@/components/layout/page-back-button";
import type { KalaidoscopeSetupState } from "@/features/create-kalaidoscope/types";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { CloudAuthPanel } from "../components/cloud-auth-panel";
import { onboardingLoginTransitions as transitions } from "./OnboardingLogin.transitions";

export default function OnboardingLogin() {
  const { go } = useAppNavigate();
  const { signedIn } = useCloudSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  // A successful sign-up navigates from its own callback. `signedIn` flips true
  // in the same beat, so without this the effect below would race it and win,
  // dumping a brand-new account on a list it cannot have anything in.
  const handledHere = useRef(false);

  useEffect(() => {
    if (signedIn && !handledHere.current) {
      go(transitions.signedIn, { replace: true });
    }
  }, [signedIn, go]);

  function handleAuthenticated({ isNewAccount }: { isNewAccount: boolean }) {
    handledHere.current = true;

    if (!isNewAccount) {
      go(transitions.signedIn, { replace: true });
      return;
    }

    const state: KalaidoscopeSetupState = {
      defaultStorage: "cloud",
      firstWorkspace: true,
    };
    go(transitions.signedUp, { replace: true, state });
  }

  return (
    <div
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-8 [scrollbar-gutter:stable]">
        <PageBackButton onClick={() => go(transitions.back)} />

        <div className="my-auto flex w-full max-w-lg flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {mode === "signin"
                ? "Sign in to Kalaido Cloud"
                : "Sign up with Kalaido Cloud"}
            </h1>
            <p className="text-[15px] text-fg-3">
              {mode === "signin"
                ? "Access your cloud workspaces and sync across all your devices."
                : "Create an account to sync your workspaces across all your devices."}
            </p>
          </div>
          <CloudAuthPanel
            mode={mode}
            onModeChange={setMode}
            onAuthenticated={handleAuthenticated}
          />
        </div>
      </main>
    </div>
  );
}

export const onboardingLoginRoute = defineRoute({
  id: "onboarding-login",
  path: "/onboarding/login",
  feature: "Onboarding",
  requiredScope: [],
  transitions,
  Component: OnboardingLogin,
});
