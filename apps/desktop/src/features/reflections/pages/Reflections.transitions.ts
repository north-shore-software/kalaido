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
  viewWindow: {
    to: "reflections",
    trigger: "Pick a window in the series to read its summary",
  },
  refine: {
    to: "refine-reflection",
    trigger: "Click ‘Refine’ to edit the reflection’s lens",
  },
});
