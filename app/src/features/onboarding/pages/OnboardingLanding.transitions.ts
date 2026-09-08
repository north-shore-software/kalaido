import { defineTransitions } from "@/routes/route-kit";

export const onboardingLandingTransitions = defineTransitions({
  logIn: {
    to: "onboarding-login",
    trigger: "Click the 'Log in to Cloud' card",
    when: "Signed out",
  },
  viewCloudWorkspaces: {
    to: "cloud-workspaces",
    trigger: "Click the 'Signed in as …' card",
    when: "A cloud session already exists",
  },
  createWorkspace: {
    to: "kalaidoscope-setup",
    trigger: "Click the 'Create New Workspace' card",
  },
});
