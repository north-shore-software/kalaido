import { defineTransitions } from "@/routes/route-kit";

export const onboardingInterstitialTransitions = defineTransitions({
  continue: {
    to: "onboarding-landing",
    trigger: "Acknowledge experimental software notice and continue",
  },
});
