import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OrganizingSplash } from "../components/organizing-splash";
import { usePipelineProgress } from "../hooks/use-pipeline-progress";
import { onboardingOrganizingTransitions as transitions } from "./OnboardingOrganizing.transitions";

export default function OnboardingOrganizing() {
  const { go } = useAppNavigate();
  const { stage, progress } = usePipelineProgress();

  const toApp = () => go(transitions.toApp, { replace: true });

  return (
    <OrganizingSplash
      progress={progress}
      ending={stage === "idle"}
      onSkip={toApp}
      onEnded={toApp}
    />
  );
}

export const onboardingOrganizingRoute = defineRoute({
  id: "onboarding-organizing",
  path: "/onboarding/organizing/:ingestId",
  feature: "Onboarding",
  requiredScope: ["kalaidoscope"],
  transitions,
  Component: OnboardingOrganizing,
});
