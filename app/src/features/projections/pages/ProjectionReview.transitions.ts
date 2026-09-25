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
  reviewNext: {
    to: "projection-review",
    trigger: "Click ‘Approve & next’ to review the next snapshot in the plan",
    when: "When something else is actionable once this approval lands",
  },
  caughtUp: {
    to: "main",
    trigger: "Approve & next with nothing left to do — back to the dashboard",
  },
  backToDetail: {
    to: "projection-detail",
    trigger: "Click ‘Come back later’ to return to projection detail",
  },
  exitWave: {
    to: "rotation",
    trigger: "Exit wave back to rotation queue",
  },
});
