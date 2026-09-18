import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import {
  Bookmarked,
  Default,
  Pending,
  SavedAsFragment,
} from "./chat-message-actions.stories";

describe("ChatMessageActions", () => {
  test("offers to bookmark", () => {
    renderStory(<Default />);
    expect(screen.getByText("Bookmark")).toBeEnabled();
  });

  test("shows the bookmarked state", () => {
    renderStory(<Bookmarked />);
    expect(screen.getByText("Bookmarked")).toBeInTheDocument();
  });

  test("shows the saved pill once a fragment exists", () => {
    renderStory(<SavedAsFragment />);
    expect(screen.getByText("saved as fragment")).toBeInTheDocument();
  });

  test("is disabled while the reply is pending", () => {
    renderStory(<Pending />);
    expect(screen.getByText("Bookmark")).toBeDisabled();
  });
});
