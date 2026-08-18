import { defineTransitions } from "@/routes/route-kit";

export const chatTransitions = defineTransitions({
  /**
   * An answer worth keeping alive stops being a stepping stone and becomes a
   * living document.
   */
  graduateToProjection: {
    to: "new-projection",
    trigger: "Click 'Make a projection' on a chat answer",
    when: "The answer has been saved as a fragment",
  },
});
