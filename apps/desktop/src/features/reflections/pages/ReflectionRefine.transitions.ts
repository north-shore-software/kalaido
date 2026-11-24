import { defineTransitions } from "@/routes/route-kit";

export const reflectionRefineTransitions = defineTransitions({
  cancel: {
    to: "reflections",
    trigger: "Click ‘Cancel’ or leave the refine screen",
  },
  commitSuccess: {
    to: "reflections",
    trigger: "Open the series after committing the lens",
  },
});
