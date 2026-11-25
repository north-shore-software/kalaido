import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditCandidateModal } from "./edit-candidate-modal";

describe("EditCandidateModal", () => {
  const originalGetAnimations = Element.prototype.getAnimations;

  afterEach(() => {
    Element.prototype.getAnimations = originalGetAnimations;
  });

  it("focuses the textarea on open", async () => {
    render(
      <EditCandidateModal
        open
        oldText="Original passage"
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.value).toBe("Original passage");
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it("retains content during close exit animation and resets draft on reopen", async () => {
    let finishCloseAnimation!: () => void;
    const finished = new Promise<void>((resolve) => {
      finishCloseAnimation = resolve;
    });
    Element.prototype.getAnimations = vi.fn(() => [
      { finished } as unknown as Animation,
    ]);

    const { rerender } = render(
      <EditCandidateModal
        open
        oldText="Original passage"
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Edited draft" },
    });
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Edited draft",
    );

    // Closing keeps the form mounted with its draft intact while the exit animation runs.
    rerender(
      <EditCandidateModal
        open={false}
        oldText="Original passage"
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Edited draft",
    );

    // Reopening (even mid-animation) resets the draft back to oldText.
    rerender(
      <EditCandidateModal
        open
        oldText="Original passage"
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Original passage",
    );

    // Closing and letting the animation finish unmounts the body.
    rerender(
      <EditCandidateModal
        open={false}
        oldText="Original passage"
        saving={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await act(async () => {
      finishCloseAnimation();
    });
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });
});
