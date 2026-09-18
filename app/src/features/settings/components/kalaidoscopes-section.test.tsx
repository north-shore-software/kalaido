import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default, Single } from "./kalaidoscopes-section.stories";

describe("KalaidoscopesSection", () => {
  test("lists the open kalaidoscope and the others", () => {
    renderStory(<Default />);
    expect(screen.getByText("Manage Kalaidoscopes")).toBeInTheDocument();
    expect(screen.getByText("Personal Journal")).toBeInTheDocument();
    expect(screen.getByText("Other scopes")).toBeInTheDocument();
    expect(screen.getByText("Research Notes")).toBeInTheDocument();
  });

  test("omits the others group when there is only one", () => {
    renderStory(<Single />);
    expect(screen.getByText("Personal Journal")).toBeInTheDocument();
    expect(screen.queryByText("Other scopes")).not.toBeInTheDocument();
  });
});
