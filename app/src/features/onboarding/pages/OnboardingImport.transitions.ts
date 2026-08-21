import { defineTransitions } from "@/routes/route-kit";

export const onboardingImportTransitions = defineTransitions({
  startPipeline: {
    to: "onboarding-organizing",
    trigger: "Click 'Import'",
    when: "The file upload was accepted by the backend",
  },
  skip: {
    to: "main",
    trigger: "Click 'Skip for now'",
  },
});
