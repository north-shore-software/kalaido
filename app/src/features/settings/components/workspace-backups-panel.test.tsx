import { fireEvent, screen } from "@testing-library/react";
import { renderStory } from "@/testing/render-story";
import { WithBackups } from "./workspace-backups-panel.stories";
import { sanitizeExportName } from "./workspace-backups-panel";

describe("WorkspaceBackupsPanel", () => {
  test("renders the three badges with their exact label text", () => {
    renderStory(<WithBackups />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("System / Safety Snapshot")).toBeInTheDocument();
  });

  test("renders the 'Back up now' button", () => {
    renderStory(<WithBackups />);
    expect(screen.getByText("Back up now")).toBeInTheDocument();
  });

  test("clicking Restore on a row opens the confirmation alert dialog with the exact text", () => {
    renderStory(<WithBackups />);
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" });
    fireEvent.click(restoreButtons[0]);
    expect(
      screen.getByText(
        "Restore this workspace? A safety snapshot of your current state will be created, and your workspace will reload.",
      ),
    ).toBeInTheDocument();
  });
});

describe("sanitizeExportName", () => {
  test("preserves valid alphanumeric names", () => {
    expect(sanitizeExportName("My Research 2026", "fallback")).toBe(
      "My Research 2026",
    );
  });

  test("strips illegal characters and collapses to dashes", () => {
    expect(sanitizeExportName('Research/Project:A*"B<C>D|E?F', "fallback")).toBe(
      "Research-Project-A-B-C-D-E-F",
    );
  });

  test("falls back to workspace id when empty or only illegal chars", () => {
    expect(sanitizeExportName(":::??***", "fallback-id")).toBe("fallback-id");
    expect(sanitizeExportName("   ", "fallback-id")).toBe("fallback-id");
  });
});
