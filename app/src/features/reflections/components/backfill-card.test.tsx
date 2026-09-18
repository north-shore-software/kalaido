import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Default } from "./backfill-card.stories";

describe("BackfillCard", () => {
  test("renders disabled until a date is picked", () => {
    renderStory(<Default />);
    expect(screen.getByText("Backfill history")).toBeInTheDocument();
    expect(screen.getByText("Backfill")).toBeDisabled();
  });
});
