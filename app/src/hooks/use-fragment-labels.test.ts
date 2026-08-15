import { fragmentLabel } from "./use-fragment-labels";

describe("fragmentLabel", () => {
  test("uses the first line, so a long document doesn't become the label", () => {
    expect(fragmentLabel("The three open questions\n\nOne. Two. Three.")).toBe(
      "The three open questions",
    );
  });

  test("truncates a long first line", () => {
    const label = fragmentLabel("x".repeat(200));
    expect(label).toHaveLength(61); // 60 chars + the ellipsis
    expect(label.endsWith("…")).toBe(true);
  });

  test("keeps a first line that is exactly at the limit intact", () => {
    const line = "x".repeat(60);
    expect(fragmentLabel(line)).toBe(line);
  });

  test("skips leading blank lines", () => {
    expect(fragmentLabel("\n\n  Actual content  \nmore")).toBe(
      "Actual content",
    );
  });

  // A fragment with no usable text still needs to render as something
  // selectable, rather than collapsing to an empty chip.
  test("falls back when there is nothing to show", () => {
    expect(fragmentLabel("")).toBe("Empty fragment");
    expect(fragmentLabel("   \n  ")).toBe("Empty fragment");
    expect(fragmentLabel(undefined)).toBe("Empty fragment");
  });
});
