import { defineTransitions } from "@/routes/route-kit";

export const newProjectionTransitions = defineTransitions({
  cancel: {
    to: "projections",
    trigger: "Click ‘Cancel’ or exit projection creation",
  },
  approveSuccess: {
    to: "projection-detail",
    trigger: "Approve newly created projection draft",
  },
});
