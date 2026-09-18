import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default } from "./nav-kalaidoscope-switcher.stories";

describe("NavKalaidoscopeSwitcher", () => {
  test("names the open kalaidoscope on the trigger", () => {
    renderStory(<Default />);
    expect(screen.getByText("Personal Journal")).toBeInTheDocument();
  });
});
