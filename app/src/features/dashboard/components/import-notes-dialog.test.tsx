import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Open } from "./import-notes-dialog.stories";

describe("ImportNotesDialog", () => {
  test("opens with the file step and a disabled import", () => {
    renderStory(<Open />);
    expect(screen.getByText("Import your notes")).toBeInTheDocument();
    expect(screen.getByText("Import")).toBeDisabled();
  });
});
