import { describe, expect, it } from "vitest";
import { diffMarkdown, segmentBlocks } from "./markdown-diff";

const doc = [
  "# Product Roadmap Q3",
  "",
  "## Phase 1: Foundation",
  "- Define styling tokens.",
  "- Standardize on Ladle.",
  "",
  "Closing paragraph.",
].join("\n");

describe("segmentBlocks", () => {
  it("splits on blank lines", () => {
    expect(segmentBlocks(doc)).toEqual([
      "# Product Roadmap Q3",
      "## Phase 1: Foundation\n- Define styling tokens.\n- Standardize on Ladle.",
      "Closing paragraph.",
    ]);
  });

  it("keeps a fence with internal blank lines as one block", () => {
    const md = "before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
    expect(segmentBlocks(md)).toEqual([
      "before",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      "after",
    ]);
  });

  it("returns no blocks for empty input", () => {
    expect(segmentBlocks("")).toEqual([]);
  });
});

describe("diffMarkdown", () => {
  it("marks identical documents as all same", () => {
    const rows = diffMarkdown(doc, doc);
    expect(rows.map((r) => r.kind)).toEqual(["same", "same", "same"]);
  });

  it("marks everything added against an empty baseline", () => {
    const rows = diffMarkdown("", doc);
    expect(rows.map((r) => r.kind)).toEqual(["added", "added", "added"]);
    expect(rows[0].right).toBe("# Product Roadmap Q3");
    expect(rows[0].left).toBeUndefined();
  });

  it("keeps heading markers outside the tags on a heading change", () => {
    const rows = diffMarkdown("# Product Roadmap Q3", "# Product Roadmap Q4");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("modified");
    expect(rows[0].left).toBe("# Product Roadmap <del>Q3</del>");
    expect(rows[0].right).toBe("# Product Roadmap <ins>Q4</ins>");
    expect(rows[0].merged).toBe("# Product Roadmap <del>Q3</del><ins>Q4</ins>");
  });

  it("wraps only the new line when a list item is appended", () => {
    const oldMd = "- one\n- two";
    const newMd = "- one\n- two\n- three";
    const rows = diffMarkdown(oldMd, newMd);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("modified");
    expect(rows[0].left).toBe("- one\n- two");
    expect(rows[0].right).toBe("- one\n- two\n- <ins>three</ins>");
  });

  it("never word-diffs code fences", () => {
    const oldMd = "```ts\nconst a = 1;\n```";
    const newMd = "```ts\nconst a = 2;\n```";
    const rows = diffMarkdown(oldMd, newMd);
    expect(rows.map((r) => r.kind)).toEqual(["removed", "added"]);
    expect(rows[0].left).toBe(oldMd);
    expect(rows[1].right).toBe(newMd);
    expect(rows[0].left).not.toContain("<del>");
  });

  it("emits pure rows for deleted and inserted paragraphs", () => {
    const rows = diffMarkdown(
      "keep me\n\ndelete me entirely, nothing shared here",
      "keep me\n\ncompletely different replacement text instead",
    );
    expect(rows[0].kind).toBe("same");
    expect(rows.slice(1).map((r) => r.kind)).toEqual(["removed", "added"]);
  });

  it("falls back to whole blocks when a change splits emphasis", () => {
    const rows = diffMarkdown(
      "some **bold text** here",
      "some **bolder text** here",
    );
    // "bold" -> "bolder" keeps the ** pair intact on both sides, so this one
    // stays modified; splitting a delimiter must demote instead.
    const splitting = diffMarkdown("plain `code span`", "plain `code` span");
    for (const rowset of [rows, splitting]) {
      for (const row of rowset) {
        for (const side of [row.left, row.right, row.merged]) {
          if (!side) continue;
          const stripped = side.replace(/<\/?(ins|del)>/g, "");
          for (const wrapped of side.matchAll(
            /<(?:ins|del)>(.*?)<\/(?:ins|del)>/g,
          )) {
            expect((wrapped[1].match(/`/g) ?? []).length % 2).toBe(0);
            expect((wrapped[1].match(/\*/g) ?? []).length % 2).toBe(0);
          }
          expect(stripped).toBeTruthy();
        }
      }
    }
  });

  it("treats whitespace-only drift as same", () => {
    const rows = diffMarkdown("a  paragraph here", "a paragraph  here");
    expect(rows.map((r) => r.kind)).toEqual(["same"]);
  });
});
