import { describe, expect, it } from "vitest";
import {
  buildMentionToken,
  mentionQueryAt,
  sanitizeMentionLabel,
  splitMentions,
  stripMentions,
  withContextItem,
} from "./mentions";

// The token grammar is mirrored in Go (kalaidoscope/internal/llmcontext/
// mentions.go); these cases correspond to that side's tests so a drift in
// either regex shows up as a failure here or there.
describe("splitMentions", () => {
  it("tokenizes a mention with surrounding text", () => {
    expect(
      splitMentions("based on @[Fragment:abc123def456ghi|standup notes], do x"),
    ).toEqual([
      { type: "text", text: "based on " },
      {
        type: "mention",
        text: "@[Fragment:abc123def456ghi|standup notes]",
        kind: "Fragment",
        id: "abc123def456ghi",
        label: "standup notes",
      },
      { type: "text", text: ", do x" },
    ]);
  });

  it("falls back to the id when the label is empty", () => {
    const [seg] = splitMentions("@[Type:email|]");
    expect(seg).toMatchObject({ type: "mention", id: "email", label: "email" });
  });

  it.each([
    "no mentions here",
    "email me at louis@example.com",
    "a bare @ sign",
    "@[Unknown:abc|label]",
    "@[Fragment:abc",
    "@[Fragment:has space|label]",
  ])("passes through %j literally", (text) => {
    expect(splitMentions(text)).toEqual([{ type: "text", text }]);
  });
});

describe("buildMentionToken", () => {
  it("sanitizes structural characters out of the label", () => {
    expect(sanitizeMentionLabel("a[b]c|d\ne")).toBe("a(b)c/d e");
    expect(buildMentionToken("Colour", "c1", "Work | life")).toBe(
      "@[Colour:c1|Work / life]",
    );
  });

  it("round-trips through splitMentions", () => {
    const token = buildMentionToken("Projection", "p1p1p1p1p1p1p1p", "Weekly");
    expect(splitMentions(token)).toEqual([
      {
        type: "mention",
        text: token,
        kind: "Projection",
        id: "p1p1p1p1p1p1p1p",
        label: "Weekly",
      },
    ]);
  });
});

describe("stripMentions", () => {
  it("reduces tokens to @Label", () => {
    expect(stripMentions("see @[Colour:c1|Work] and @[Type:email|]")).toBe(
      "see @Work and @email",
    );
  });
});

describe("mentionQueryAt", () => {
  it("finds the mention being typed at the caret", () => {
    expect(mentionQueryAt("hello @wor", 10)).toEqual({
      start: 6,
      query: "wor",
    });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("does not trigger mid-word, across whitespace, or after a completed token", () => {
    expect(mentionQueryAt("louis@exa", 9)).toBeNull();
    expect(mentionQueryAt("@word and", 9)).toBeNull();
    expect(mentionQueryAt("@[Colour:c1|Work]", 17)).toBeNull();
    expect(mentionQueryAt("plain text", 5)).toBeNull();
  });
});

describe("withContextItem", () => {
  it("appends new items and ignores kind+id duplicates", () => {
    const a = { kind: "Colour" as const, id: "c1", label: "Work" };
    const items = withContextItem([], a);
    expect(items).toEqual([a]);
    expect(withContextItem(items, { ...a, label: "renamed" })).toBe(items);
    expect(
      withContextItem(items, { kind: "Fragment", id: "c1", label: "x" }),
    ).toHaveLength(2);
  });
});
