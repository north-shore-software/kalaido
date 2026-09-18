import { fireEvent, render, screen } from "@testing-library/react";
import { Default, Fallback } from "./panel-error-boundary.stories";

describe("PanelErrorBoundary", () => {
  test("catches a render error, shows the fallback, and recovers", () => {
    // React reports caught render errors on the console; keep the run quiet.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(<Default />);
      expect(screen.getByTestId("panel-content")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Break the panel"));
      expect(
        screen.getByText(/Something went wrong drawing this panel/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Try again"));
      expect(screen.getByTestId("panel-content")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("renders the fallback card with its message", () => {
    render(<Fallback />);
    expect(
      screen.getByText(/Something went wrong drawing the chat/),
    ).toBeInTheDocument();
    expect(screen.getByText(/reading 'parts'/)).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });
});
