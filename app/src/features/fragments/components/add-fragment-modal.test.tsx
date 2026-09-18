import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Open } from "./add-fragment-modal.stories";

describe("AddFragmentModal", () => {
  test("opens empty with save disabled", () => {
    renderStory(<Open />);
    expect(screen.getByText("New Fragment")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
  });
});
