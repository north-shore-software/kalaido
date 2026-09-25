import { defineTransitions } from "@/routes/route-kit";

export const mainTransitions = defineTransitions({
  openReflection: {
    to: "reflections",
    trigger: "Click a reflection card",
  },
  openProjection: {
    to: "projection-detail",
    trigger: "Click a projection card",
  },
  openProposal: {
    to: "new-projection",
    trigger: "Open a proposed projection",
  },
  openProposedReflection: {
    to: "refine-reflection",
    trigger: "Open a proposed reflection",
  },
  reviewProjection: {
    to: "projection-review",
    trigger: "Click a projection snapshot to review",
  },
  startPipeline: {
    to: "onboarding-organizing",
    trigger: "Click 'Import' in the dashboard import modal for the first time",
  },
  openExplore: {
    to: "explore",
    trigger: "Click explore card",
  },
  toApp: {
    to: "main",
    trigger:
      "Click 'Import' in the dashboard import modal when user already has saved fragments",
  },
});
