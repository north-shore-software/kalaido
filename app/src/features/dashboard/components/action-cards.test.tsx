import { screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { Hero, Row } from "./action-cards.stories";

describe("ActionCards", () => {
  test("hero layout carries both actions", () => {
    renderStory(<Hero />);
    expect(screen.getByText("Capture a new fragment")).toBeInTheDocument();
    expect(screen.getByText("Import your notes")).toBeInTheDocument();
  });

  test("row layout uses the shorter import copy", () => {
    renderStory(<Row />);
    expect(screen.getByText("Import more notes")).toBeInTheDocument();
  });
});
