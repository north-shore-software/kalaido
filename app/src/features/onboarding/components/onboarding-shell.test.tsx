import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default, WithoutMark } from "./onboarding-shell.stories";

describe("OnboardingShell", () => {
  test("renders title, description and children", () => {
    renderStory(<Default />);
    expect(screen.getByText("Welcome to Kalaido")).toBeInTheDocument();
    expect(
      screen.getByText("Where would you like to start?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Page content goes here.")).toBeInTheDocument();
  });

  test("renders without the mark", () => {
    renderStory(<WithoutMark />);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});
