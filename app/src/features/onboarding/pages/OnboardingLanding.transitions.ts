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
  createForImport: {
    to: "kalaidoscope-setup",
    trigger: "Click the 'Import your notes' card",
    when: "Setup then lands on the onboarding import page",
  },
  createWorkspace: {
    to: "kalaidoscope-setup",
    trigger: "Click the 'Start from blank' card",
  },
});
