import { defineTransitions } from "@/routes/route-kit";

export const reflectionsTransitions = defineTransitions({
  newReflection: {
    to: "new-reflection",
    trigger: "Click ‘New Reflection’ in header",
  },
  selectReflection: {
    to: "reflections",
    trigger: "Click a reflection in the sidebar to open",
  },
  viewSnapshot: {
    to: "reflections",
    trigger: "Navigate to a historical reflection snapshot",
  },
});
