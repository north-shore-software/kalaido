import { defineTransitions } from "@/routes/route-kit";

export const selectTemplateTransitions = defineTransitions({
  setupKalaidoscope: {
    to: "kalaidoscope-setup",
    trigger: "Click a template to start setup",
  },
});
