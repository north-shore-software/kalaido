import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Busy, Open } from "./duplicate-workspace-dialog.stories";

describe("DuplicateWorkspaceDialog", () => {
  test("names the existing workspace", () => {
    renderStory(<Open />);
    expect(screen.getByText("Workspace Already Exists")).toBeInTheDocument();
    expect(screen.getByText(/Personal Journal/)).toBeInTheDocument();
    expect(screen.getByText("Restore as New Copy")).toBeEnabled();
  });

  test("disables both actions while busy", () => {
    renderStory(<Busy />);
    expect(screen.getByText("Restore as New Copy")).toBeDisabled();
    expect(screen.getByText("Cancel")).toBeDisabled();
  });
});
