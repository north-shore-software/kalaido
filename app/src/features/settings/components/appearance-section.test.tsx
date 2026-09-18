import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default } from "./appearance-section.stories";

describe("AppearanceSection", () => {
  test("renders the section with its theme toggle", () => {
    renderStory(<Default />);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });
});
