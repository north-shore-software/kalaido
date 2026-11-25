import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentCard } from "./document-card";
import { FragmentCard } from "./fragment-card";
import { ListRow } from "./list-row";
import { PinToggle } from "./pin-toggle";

function assertNoNestedButtons(container: HTMLElement) {
  expect(container.querySelectorAll("button button").length).toBe(0);
  expect(container.querySelectorAll("button a").length).toBe(0);
  expect(container.querySelectorAll('[role="button"]').length).toBe(0);
}

describe("Interactive rows and cards accessibility", () => {
  it("renders ListRow + PinToggle as sibling native buttons without nesting", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();

    const { container } = render(
      <ListRow
        title="Weekly Reflection"
        subtitle="Mondays"
        onClick={onSelect}
        trailing={<PinToggle pinned={false} onToggle={onToggle} />}
      />,
    );

    assertNoNestedButtons(container);

    fireEvent.click(screen.getByRole("button", { name: /Weekly Reflection/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders DocumentCard + sibling trailing action button without nesting", () => {
    const onOpen = vi.fn();
    const onUnpin = vi.fn();

    const { container } = render(
      <DocumentCard
        title="Project Roadmap"
        onClick={onOpen}
        trailing={
          <button type="button" aria-label="Unpin" onClick={onUnpin}>
            ×
          </button>
        }
      >
        <p>Summary body text</p>
      </DocumentCard>,
    );

    assertNoNestedButtons(container);

    const primary = screen.getByRole("button", { name: "Project Roadmap" });
    fireEvent.click(primary);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onUnpin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders interactive FragmentCard with native button and preserves data-testid", () => {
    const onOpen = vi.fn();

    const { container } = render(
      <FragmentCard
        type="note"
        title="Morning notes"
        time="09:15"
        preview={
          <>
            Check <a href="https://example.com">external reference</a>
          </>
        }
        onClick={onOpen}
      />,
    );

    assertNoNestedButtons(container);
    expect(screen.getByTestId("fragment-card")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Morning notes" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
