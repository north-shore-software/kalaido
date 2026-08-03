import { defineTransitions } from "@/routes/route-kit";

export const newReflectionTransitions = defineTransitions({
  cancel: {
    to: "reflections",
    trigger: "Click ‘Cancel’ or exit reflection creation",
  },
  commitSuccess: {
    to: "reflections",
    trigger: "Navigate to reflection detail after committing",
  },
});
