import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ItemPicker } from "./item-picker";

describe("ItemPicker mount focus", () => {
  it("focuses the search input on mount without autoFocus", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();

    render(
      <ItemPicker
        kindLabel="Colour"
        tint="section"
        options={[
          { id: "c1", label: "Work" },
          { id: "c2", label: "Personal" },
        ]}
        onPick={onPick}
        onClose={onClose}
        emptyCopy="No colours"
      />,
    );

    const input = screen.getByPlaceholderText("Search colours…");
    expect(document.activeElement).toBe(input);
    expect(input.hasAttribute("autofocus")).toBe(false);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "c1", label: "Work" });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("supports an external inputRef", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(
      <ItemPicker
        kindLabel="Fragment"
        tint="magenta"
        options={[]}
        onPick={vi.fn()}
        onClose={vi.fn()}
        emptyCopy="Nothing found"
        inputRef={inputRef}
      />,
    );

    const input = screen.getByPlaceholderText("Search fragments…");
    expect(inputRef.current).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});
