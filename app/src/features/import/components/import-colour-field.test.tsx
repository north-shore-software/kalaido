import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { isImportColourReady } from "./import-colour-field";
import { Existing, NewColour, None } from "./import-colour-field.stories";

describe("ImportColourField", () => {
  test("hides the name field unless a new colour is chosen", () => {
    renderStory(<None />);
    expect(screen.queryByLabelText("New colour name")).not.toBeInTheDocument();
  });

  test("shows the chosen colour", () => {
    renderStory(<Existing />);
    expect(screen.getByLabelText("Colour")).toHaveTextContent("Incidents");
  });

  test("asks for a name when creating a colour", () => {
    renderStory(<NewColour />);
    expect(screen.getByLabelText("New colour name")).toBeInTheDocument();
  });

  test("a new colour is ready only once it has a name", () => {
    expect(isImportColourReady({ kind: "none" })).toBe(true);
    expect(isImportColourReady({ kind: "new", name: "  " })).toBe(false);
    expect(isImportColourReady({ kind: "new", name: "Incidents" })).toBe(true);
  });
});
