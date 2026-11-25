import { defineTransitions } from "@/routes/route-kit";

export const bootErrorTransitions = defineTransitions({
  backToOnboarding: {
    to: "onboarding-landing",
    trigger: "Click 'Back' on failed cloud container startup",
  },
  backToCloudWorkspaces: {
    to: "cloud-workspaces",
    trigger: "Click 'Back' on failed cloud container startup when signed in",
  },
});
