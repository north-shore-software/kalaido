import { fireEvent, screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default } from "./danger-zone-section.stories";

describe("DangerZoneSection", () => {
  test("asks for confirmation before resetting", () => {
    renderStory(<Default />);
    expect(screen.getByText("Danger Zone")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByText("Yes, reset")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });
});
