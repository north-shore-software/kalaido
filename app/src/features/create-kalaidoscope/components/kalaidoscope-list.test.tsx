import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default, Empty, ExcludingCurrent } from "./kalaidoscope-list.stories";

describe("KalaidoscopeList", () => {
  test("lists every available kalaidoscope", () => {
    renderStory(<Default />);
    expect(screen.getByText("Personal Journal")).toBeInTheDocument();
    expect(screen.getByText("Research Notes")).toBeInTheDocument();
    expect(screen.getByText("Team Workspace")).toBeInTheDocument();
  });

  test("leaves out the excluded one", () => {
    renderStory(<ExcludingCurrent />);
    expect(screen.queryByText("Personal Journal")).not.toBeInTheDocument();
    expect(screen.getByText("Research Notes")).toBeInTheDocument();
  });

  test("renders nothing when there is nothing to list", () => {
    renderStory(<Empty />);
    expect(screen.queryByText("Personal Journal")).not.toBeInTheDocument();
  });
});
