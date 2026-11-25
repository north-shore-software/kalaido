import type { FragmentResponse } from "@kalaido/client/kalaidoscope/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColourComposerPane } from "./colour-composer-pane";

function makeFragment(
  id: string,
  type: "email" | "note",
  content: string,
): FragmentResponse {
  return {
    id,
    type,
    content,
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    occurred_at: "2026-01-01T00:00:00.000Z",
    collectionId: "fragment",
    collectionName: "fragment",
  } as unknown as FragmentResponse;
}

describe("ColourComposerPane", () => {
  const matches = [
    makeFragment("f1", "email", "Email feedback body"),
    makeFragment("f2", "note", "Quick note body"),
  ];

  it("narrows preview matches by type chip and resets to All on remount", () => {
    const { unmount } = render(
      <ColourComposerPane
        name="Feedback"
        prompt="customer pain points"
        previewing={false}
        matches={matches}
        onName={vi.fn()}
        onPrompt={vi.fn()}
      />,
    );

    expect(screen.queryByText("2 matches")).not.toBeNull();
    expect(screen.queryByText("Email feedback body")).not.toBeNull();
    expect(screen.queryByText("Quick note body")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    expect(screen.queryByText("1 match")).not.toBeNull();
    expect(screen.queryByText("Email feedback body")).toBeNull();
    expect(screen.queryByText("Quick note body")).not.toBeNull();

    unmount();

    render(
      <ColourComposerPane
        name=""
        prompt="customer pain points"
        previewing={false}
        matches={matches}
        onName={vi.fn()}
        onPrompt={vi.fn()}
      />,
    );

    expect(screen.queryByText("2 matches")).not.toBeNull();
    expect(screen.queryByText("Email feedback body")).not.toBeNull();
    expect(screen.queryByText("Quick note body")).not.toBeNull();
  });
});
