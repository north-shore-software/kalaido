import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Open, Saving, WithError } from "./edit-candidate-modal.stories";

describe("EditCandidateModal", () => {
  test("opens on the passage with apply disabled until it changes", () => {
    renderStory(<Open />);
    expect(screen.getByText("Edit selection")).toBeInTheDocument();
    expect(screen.getByText("Apply edit")).toBeDisabled();
  });

  test("shows the applying state", () => {
    renderStory(<Saving />);
    expect(screen.getByText("Applying…")).toBeInTheDocument();
  });

  test("shows the error", () => {
    renderStory(<WithError />);
    expect(
      screen.getByText("That passage is no longer in the candidate."),
    ).toBeInTheDocument();
  });
});
