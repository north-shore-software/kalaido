import { render, screen } from "@testing-library/react";
import { mockRecentFragments } from "../fixtures";
import { Default, Empty, Loading } from "./recent-fragments-sidebar.stories";

describe("RecentFragmentsSidebar", () => {
  describe("Default", () => {
    test("renders", () => {
      render(<Default />);

      expect(screen.getByText("Recent fragments")).toBeInTheDocument();
      expect(screen.getAllByTestId("fragment-card").length).toBe(
        mockRecentFragments.length,
      );
    });
  });

  describe("Loading", () => {
    test("renders", () => {
      render(<Loading />);

      expect(screen.getByText("Recent fragments")).toBeInTheDocument();
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });
  });

  describe("Empty", () => {
    test("renders", () => {
      render(<Empty />);

      expect(screen.getByText("Recent fragments")).toBeInTheDocument();
      expect(screen.getByText("No fragments yet.")).toBeInTheDocument();
    });
  });
});
