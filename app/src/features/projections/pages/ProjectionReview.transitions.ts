import { defineTransitions } from "@/routes/route-kit";

export const projectionReviewTransitions = defineTransitions({
  viewReview: {
    to: "projection-review",
    trigger: "Navigate to a projection review snapshot",
  },
  approveSuccess: {
    to: "projection-detail",
    trigger: "Navigate to projection detail after approval",
  },
  backToList: {
    to: "projections",
    trigger: "Click ‘Come back later’ to go back to projections list",
  },
});
