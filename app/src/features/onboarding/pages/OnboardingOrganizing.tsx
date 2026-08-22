import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OrganizingSplash } from "../components/organizing-splash";
import { usePipelineProgress } from "../hooks/use-pipeline-progress";
import { onboardingOrganizingTransitions as transitions } from "./OnboardingOrganizing.transitions";

export default function OnboardingOrganizing() {
  const { go } = useAppNavigate();
  const { ingestId = "" } = useParams<{ ingestId: string }>();
  const { stage, progress } = usePipelineProgress(ingestId);

  const toApp = () => go(transitions.toApp, { replace: true });

  useEffect(() => {
    if (stage === "error") {
      go(transitions.toApp, { replace: true });
    }
  }, [stage, go]);

  return (
    <OrganizingSplash
      progress={progress}
      ending={stage === "done"}
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
