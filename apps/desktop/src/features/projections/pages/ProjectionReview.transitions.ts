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
  backToDetail: {
    to: "projection-detail",
    trigger: "Click ‘Come back later’ to return to projection detail",
  },
});
