import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useIngestPipeline } from "@/hooks/use-ingest-pipeline";
import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { OnboardingShell } from "../components/onboarding-shell";
import { onboardingOrganizingTransitions as transitions } from "./OnboardingOrganizing.transitions";

export default function OnboardingOrganizing() {
  const { go } = useAppNavigate();
  const { ingestId = "" } = useParams<{ ingestId: string }>();
  const { stage } = useIngestPipeline(ingestId);

  useEffect(() => {
    if (stage === "done" || stage === "error") {
      go(transitions.toApp, { replace: true });
    }
  }, [stage, go]);

  return (
    <OnboardingShell title="Organising your notes">
      <div className="flex justify-center">
        <Button
          variant="ghost"
          onClick={() => go(transitions.toApp, { replace: true })}
        >
          Skip to app
        </Button>
      </div>
    </OnboardingShell>
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
