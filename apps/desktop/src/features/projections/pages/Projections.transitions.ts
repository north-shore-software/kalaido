import { defineTransitions } from "@/routes/route-kit";

export const projectionsTransitions = defineTransitions({
  newProjection: {
    to: "new-projection",
    trigger: "Click ‘New Projection’ in header",
  },
  openProjection: {
    to: "projection-detail",
    trigger: "Click a projection card to open",
  },
  reviewProjection: {
    to: "projection-review",
    trigger: "Click a projection card snapshot to review",
  },
});
