import { describe, expect, it } from "vitest";
import sharedFixture from "../../../kalaidoscope/internal/engine/testdata/markdown_segmentation.json";
import {
  formatEditMarker,
  parseEditMarker,
  segmentBlockRanges,
  segmentBlocks,
} from "./markdown-diff";

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

describe("segmentBlockRanges", () => {
  const cases: Record<string, string> = {
    "multiple blank lines": "one\n\n\n\ntwo\nstill two\n\nthree",
    "whitespace-only separator lines": "one\n  \n\t\ntwo",
    "fence with internal blanks": "before\n\n```ts\na\n\nb\n```\n\nafter",
    "no trailing newline": "a\n\nb",
    "trailing newlines": "a\n\nb\n\n",
    "leading blank lines": "\n\na\n\nb",
    "single block": "just one line",
    empty: "",
  };
  for (const [name, md] of Object.entries(cases)) {
    it(`slices exactly: ${name}`, () => {
      for (const b of segmentBlockRanges(md)) {
        expect(md.slice(b.start, b.end)).toBe(b.text);
      }
    });
    it(`agrees with segmentBlocks: ${name}`, () => {
      expect(segmentBlockRanges(md).map((b) => b.text)).toEqual(
        segmentBlocks(md),
      );
    });
  }

  it("slicing a run of blocks reproduces the source between them", () => {
    const md = "# T\n\nalpha\n\n\ngamma\n\ndelta";
    const r = segmentBlockRanges(md);
    expect(md.slice(r[1].start, r[2].end)).toBe("alpha\n\n\ngamma");
  });
});

describe("shared markdown segmentation fixture", () => {
  for (const c of sharedFixture.segmentationCases) {
    it(`segments correctly: ${c.name}`, () => {
      expect(segmentBlocks(c.markdown)).toEqual(c.expectedBlocks);
      expect(segmentBlockRanges(c.markdown).map((b) => b.text)).toEqual(
        c.expectedBlocks,
      );
    });
  }

  for (const c of sharedFixture.markerCases) {
    it(`handles edit marker: ${c.id}`, () => {
      expect(formatEditMarker(c.id)).toBe(`<<<edit:${c.id}>>>`);
      const parsed = parseEditMarker(c.formatted);
      if (c.valid) {
        expect(parsed).toBe(c.id);
      } else {
        expect(parsed).toBeNull();
      }
    });
  }
});
