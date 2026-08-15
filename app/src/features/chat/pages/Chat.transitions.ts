import { defineTransitions } from "@/routes/route-kit";

export const chatTransitions = defineTransitions({
  /**
   * The end of the refocus loop: an answer that has been narrowed down enough
   * stops being a stepping stone and becomes a living document.
   */
  graduateToProjection: {
    to: "new-projection",
    trigger: "Click 'Make a projection' on a chat answer",
    when: "The answer has been saved as a fragment",
  },
});
