import { describe, expect, it } from "vitest";
import { deriveName } from "./naming";

describe("deriveName", () => {
  it("uses the fallback for blank input", () => {
    expect(deriveName("", "Untitled projection")).toBe("Untitled projection");
    expect(deriveName("   \n ", "Untitled reflection")).toBe(
      "Untitled reflection",
    );
  });

  it("keeps prompts of six words or fewer whole, whitespace collapsed", () => {
    expect(deriveName("  weekly   team digest ", "x")).toBe(
      "weekly team digest",
    );
    expect(deriveName("one two three four five six", "x")).toBe(
      "one two three four five six",
    );
  });

  it("shortens longer prompts to six words plus an ellipsis", () => {
    expect(deriveName("one two three four five six seven", "x")).toBe(
      "one two three four five six…",
    );
  });
});
