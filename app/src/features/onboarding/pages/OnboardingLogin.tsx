import { ArrowLeftIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useCloudSession } from "@/hooks/use-cloud-session.ts";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { CloudAuthPanel } from "../components/cloud-auth-panel";
import { onboardingLoginTransitions as transitions } from "./OnboardingLogin.transitions";

export default function OnboardingLogin() {
  const { go } = useAppNavigate();
  const { signedIn } = useCloudSession();

  useEffect(() => {
    if (signedIn) go(transitions.signedIn, { replace: true });
  }, [signedIn, go]);

  return (
    <div
      className="flex flex-col overflow-auto bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex flex-1 flex-col items-center p-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => go(transitions.back)}
          className="absolute top-4 left-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon />
          Back
        </Button>

        <div className="mt-16 flex w-full max-w-sm flex-col gap-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Sign in to Kalaido Cloud
          </h1>
          <CloudAuthPanel
            onAuthenticated={() => go(transitions.signedIn, { replace: true })}
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
