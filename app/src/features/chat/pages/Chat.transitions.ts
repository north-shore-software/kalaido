import { defineTransitions } from "@/routes/route-kit";

export const chatTransitions = defineTransitions({
  /**
   * The session's gathered turns stop being stepping stones and become the
   * inputs of a living document, opened with the brief the chat arrived at.
   */
  graduateToProjection: {
    to: "new-projection",
    trigger: "Click 'Start projection' in the Bookmarks tray",
    when: "The bookmarked turns have been saved as fragments and a brief exists",
  },
  /**
   * The gathered turns become the seed of a new colour: saved as fragments,
   * then pinned as its positive examples.
   */
  newColourFromBookmarks: {
    to: "colours",
    trigger: "Click 'New colour…' in the Bookmarks tray",
    when: "The bookmarked turns have been saved as fragments",
  },
});
