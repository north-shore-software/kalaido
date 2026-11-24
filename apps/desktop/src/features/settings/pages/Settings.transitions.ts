import { defineTransitions } from "@/routes/route-kit";

export const settingsTransitions = defineTransitions({
  close: {
    to: "main",
    trigger: "Click ‘Back’ to exit settings",
  },
  selectSection: {
    to: "settings",
    trigger: "Click a settings section",
  },
});
