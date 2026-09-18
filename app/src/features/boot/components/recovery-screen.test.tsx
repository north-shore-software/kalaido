import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default, WithSwitcher } from "./recovery-screen.stories";

describe("RecoveryScreen", () => {
  test("shows the title, the retry and the reset offer", () => {
    renderStory(<Default />);
    expect(screen.getByText("Kalaido could not start")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.getByText("Reset app settings")).toBeInTheDocument();
    expect(
      screen.queryByText("Open a different kalaidoscope"),
    ).not.toBeInTheDocument();
  });

  test("offers the other kalaidoscopes when allowed", () => {
    renderStory(<WithSwitcher />);
    expect(
      screen.getByText("Open a different kalaidoscope"),
    ).toBeInTheDocument();
    expect(screen.getByText("Research Notes")).toBeInTheDocument();
    expect(screen.queryByText("Personal Journal")).not.toBeInTheDocument();
  });
});
