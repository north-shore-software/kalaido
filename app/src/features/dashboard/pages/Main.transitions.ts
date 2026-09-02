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
  reviewProjection: {
    to: "projection-review",
    trigger: "Click a projection snapshot to review",
  },
});
