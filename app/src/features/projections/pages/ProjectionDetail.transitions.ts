import { defineTransitions } from "@/routes/route-kit";

export const projectionDetailTransitions = defineTransitions({
  reviewCandidate: {
    to: "projection-review",
    trigger: "Navigate to a pending candidate for review",
  },
  viewLive: {
    to: "projection-detail",
    trigger: "Navigate to the live projection snapshot",
  },
  viewSnapshot: {
    to: "projection-detail",
    trigger: "Navigate to a historical projection snapshot",
  },
  backToList: {
    to: "projections",
    trigger: "Cancel the draft editor and go back to projections list",
  },
  openDetail: {
    to: "projection-detail",
    trigger: "Navigate to a specific projection detail",
  },
});
