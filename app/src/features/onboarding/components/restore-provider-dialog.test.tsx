import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Open } from "./restore-provider-dialog.stories";

describe("RestoreProviderDialog", () => {
  test("explains why a model is needed and waits for one", () => {
    renderStory(<Open />);
    expect(screen.getByText("This backup needs a model")).toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeDisabled();
  });
});
