import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportAdapter } from "#import";
import { AddFragmentModal } from "./add-fragment-modal";

const { useLiveCollection, useNoteIngest } = vi.hoisted(() => ({
  useLiveCollection: vi.fn(() => ({ records: [] })),
  useNoteIngest: vi.fn(() => ({
    phase: "idle" as const,
    errorMsg: null as string | null,
    runIngest: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock("@kalaido/hooks/use-live-collection", () => ({
  useLiveCollection,
}));

vi.mock("../hooks/use-note-ingest", () => ({
  useNoteIngest,
}));

vi.mock("#import", () => ({
  SUPPORTED_EXTENSIONS_HINT: ".md, .txt",
  isImportColourReady: () => true,
  useImportPicker: () => ({
    path: null,
    file: null,
    entries: [],
    scanning: false,
    pickError: null,
    chooseFile: vi.fn(),
    clear: vi.fn(),
  }),
  useImportSubmit: () => ({
    submitting: false,
    submitError: null,
    submit: vi.fn(),
    clearError: vi.fn(),
  }),
  ImportColourField: () => <div data-testid="import-colour-field" />,
  ImportPreview: () => <div data-testid="import-preview" />,
}));

const stubAdapter = {} as ImportAdapter;

describe("AddFragmentModal", () => {
  const originalGetAnimations = Element.prototype.getAnimations;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Element.prototype.getAnimations = originalGetAnimations;
  });

  it("does not mount inner body while closed and focuses textarea on open", async () => {
    const { rerender } = render(
      <AddFragmentModal
        open={false}
        onClose={vi.fn()}
        importAdapter={stubAdapter}
      />,
    );

    expect(useLiveCollection).not.toHaveBeenCalled();

    rerender(
      <AddFragmentModal open onClose={vi.fn()} importAdapter={stubAdapter} />,
    );

    expect(useLiveCollection).toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("textbox"));
    });
  });

  it("retains content during exit animation and resets draft and tab on reopen", async () => {
    let finishCloseAnimation!: () => void;
    const finished = new Promise<void>((resolve) => {
      finishCloseAnimation = resolve;
    });
    Element.prototype.getAnimations = vi.fn(() => [
      { finished } as unknown as Animation,
    ]);

    const { rerender } = render(
      <AddFragmentModal open onClose={vi.fn()} importAdapter={stubAdapter} />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Unsaved note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    expect(
      screen
        .getByRole("button", { name: "Import file" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // Switching back within the same session preserves the draft.
    fireEvent.click(screen.getByRole("button", { name: "Start writing" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "Unsaved note",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("textbox"));
    });

    // Switch back to import tab before closing so reopen verifies tab reset too.
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));

    rerender(
      <AddFragmentModal
        open={false}
        onClose={vi.fn()}
        importAdapter={stubAdapter}
      />,
    );
    // Body stays mounted during exit animation.
    expect(
      screen.queryByRole("button", { name: "Import file" }),
    ).not.toBeNull();

    await act(async () => {
      finishCloseAnimation();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Import file" })).toBeNull();
    });

    // Reopening starts fresh on "Start writing" with empty draft and focused textarea.
    rerender(
      <AddFragmentModal open onClose={vi.fn()} importAdapter={stubAdapter} />,
    );
    expect(
      screen
        .getByRole("button", { name: "Start writing" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(textarea.value).toBe("");
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });
});
