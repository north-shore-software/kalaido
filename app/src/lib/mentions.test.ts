import { describe, expect, it } from "vitest";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { WHOLE_SCOPE_ITEM } from "@/api/kalaidoscope/context-items";
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
  const colour = { kind: "Colour" as const, id: "c1", label: "Work" };
  const type = { kind: "Type" as const, id: "email", label: "Email" };
  const pin = { kind: "Fragment" as const, id: "f1", label: "standup" };

  it("treats a colour or type tag as a no-op on a whole-scope selection", () => {
    // Everything is already checked, so there is nothing to add.
    const empty: ContextItem[] = [];
    expect(withContextItem(empty, colour)).toBe(empty);
    const marked = [WHOLE_SCOPE_ITEM, pin];
    expect(withContextItem(marked, type)).toBe(marked);
  });

  it("checks a colour or type on an enumerated selection", () => {
    const enumerated: ContextItem[] = [type];
    expect(withContextItem(enumerated, colour)).toEqual([type, colour]);
  });

  it("pinning onto the empty selection materialises the whole-scope marker", () => {
    // The pin adds to the union — the scope must not narrow to just the pin.
    expect(withContextItem([], pin)).toEqual([WHOLE_SCOPE_ITEM, pin]);
    expect(withContextItem([WHOLE_SCOPE_ITEM], pin)).toEqual([
      WHOLE_SCOPE_ITEM,
      pin,
    ]);
  });

  it("appends pins to an enumerated selection and ignores kind+id duplicates", () => {
    const items = withContextItem([type], pin);
    expect(items).toEqual([type, pin]);
    expect(withContextItem(items, { ...pin, label: "renamed" })).toBe(items);
    expect(
      withContextItem(items, { kind: "Projection", id: "f1", label: "x" }),
    ).toHaveLength(3);
  });
});
