import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { fixtureBookmarkRows } from "../fixtures";
import { Default, Empty } from "./bookmarks-tray.stories";

describe("BookmarksTray", () => {
  test("lists every bookmarked turn with a remove button", () => {
    renderStory(<Default />);
    expect(screen.getByText("Bookmarks")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Remove bookmark").length).toBe(
      fixtureBookmarkRows.length,
    );
    expect(screen.getByText("saved")).toBeInTheDocument();
  });

  test("shows the empty state", () => {
    renderStory(<Empty />);
    expect(screen.getByText("Nothing bookmarked yet")).toBeInTheDocument();
  });
});
