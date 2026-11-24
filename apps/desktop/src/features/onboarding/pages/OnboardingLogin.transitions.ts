import { defineTransitions } from "@/routes/route-kit";

export const onboardingLoginTransitions = defineTransitions({
  back: {
    to: "onboarding-landing",
    trigger: "Click 'Back'",
  },
  signedIn: {
    to: "cloud-workspaces",
    trigger: "Sign in succeeds",
    animation: "replace — the login screen is not a back destination",
  },
  signedUp: {
    to: "kalaidoscope-setup",
    trigger: "Sign up succeeds",
    when: "Brand-new account — there is nothing to list yet",
    animation: "replace — the login screen is not a back destination",
  },
});
