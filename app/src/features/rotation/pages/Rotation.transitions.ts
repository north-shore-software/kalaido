import { defineTransitions } from "@/routes/route-kit";

export const rotationTransitions = defineTransitions({
  tweakCandidate: {
    to: "projection-review",
    trigger: "Click 'Tweak' on an active rotation card",
    when: "When there is a pending candidate draft for the current projection",
  },
});
