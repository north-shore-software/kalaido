import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Empty, WithError, WithFile } from "./import-fields.stories";

describe("ImportFields", () => {
  test("starts with only the file picker", () => {
    renderStory(<Empty />);
    expect(screen.getByLabelText("Choose file")).toBeInTheDocument();
    expect(screen.queryByTitle("notes/intro.txt")).not.toBeInTheDocument();
  });

  test("previews the chosen file's entries", () => {
    renderStory(<WithFile />);
    expect(screen.getByTitle("notes/intro.txt")).toBeInTheDocument();
  });

  test("shows the preview error", () => {
    renderStory(<WithError />);
    expect(
      screen.getByText("Couldn't read that file to preview it."),
    ).toBeInTheDocument();
  });
});
