import { describe, expect, it } from "vitest";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import {
  SUMMARIES_ITEM,
  setScopeMode,
  WHOLE_SCOPE_ITEM,
} from "@/api/kalaidoscope/context-items";
import { addPin, deriveBarState, fullBlockedBy, removePin } from "./state";

const frag: ContextItem = { kind: "Fragment", id: "f1", label: "standup" };
const colour: ContextItem = { kind: "Colour", id: "c1", label: "Work" };
const proj: ContextItem = { kind: "Projection", id: "p1", label: "weekly" };

describe("deriveBarState", () => {
  it("reads the three canonical forms", () => {
    expect(deriveBarState([WHOLE_SCOPE_ITEM, proj])).toEqual({
      mode: "full",
      pins: [proj],
      hasContentPins: false,
    });
    expect(deriveBarState([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, frag])).toEqual({
      mode: "summaries",
      pins: [frag],
      hasContentPins: true,
    });
    expect(deriveBarState([frag, proj])).toEqual({
      mode: "off",
      pins: [frag, proj],
      hasContentPins: true,
    });
    expect(deriveBarState([])).toEqual({
      mode: "off",
      pins: [],
      hasContentPins: false,
    });
  });

  it("tolerates a legacy Full + content pin selection", () => {
    // The old bar produced these; they render as Full with chips and the
    // backend reads the pins in full either way.
    const state = deriveBarState([WHOLE_SCOPE_ITEM, frag]);
    expect(state.mode).toBe("full");
    expect(state.hasContentPins).toBe(true);
    expect(fullBlockedBy(state, undefined)).toBe("pins");
  });
});

describe("setScopeMode", () => {
  it("round-trips through every mode keeping the pins", () => {
    const start = [WHOLE_SCOPE_ITEM, proj];
    const summaries = setScopeMode(start, "summaries");
    expect(summaries).toEqual([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, proj]);
    const off = setScopeMode(summaries, "off");
    expect(off).toEqual([proj]);
    expect(setScopeMode(off, "full")).toEqual(start);
  });

  it("is identity when the mode already holds", () => {
    const items = [WHOLE_SCOPE_ITEM, SUMMARIES_ITEM];
    expect(setScopeMode(items, "summaries")).toBe(items);
    expect(setScopeMode([], "off")).toEqual([]);
  });
});

describe("pins", () => {
  it("refuses content pins on Full and accepts snapshot pins", () => {
    const full = [WHOLE_SCOPE_ITEM];
    expect(addPin(full, frag)).toBe(full);
    expect(addPin(full, colour)).toBe(full);
    expect(addPin(full, proj)).toEqual([WHOLE_SCOPE_ITEM, proj]);
  });

  it("accepts content pins on Summaries and Off", () => {
    expect(addPin([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM], colour)).toEqual([
      WHOLE_SCOPE_ITEM,
      SUMMARIES_ITEM,
      colour,
    ]);
    expect(addPin([], frag)).toEqual([frag]);
  });

  it("removes by kind+id and leaves the markers alone", () => {
    expect(removePin([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, frag], frag)).toEqual([
      WHOLE_SCOPE_ITEM,
      SUMMARIES_ITEM,
    ]);
    expect(removePin([WHOLE_SCOPE_ITEM, proj], proj)).toEqual([
      WHOLE_SCOPE_ITEM,
    ]);
    const items = [frag];
    expect(removePin(items, { kind: "Fragment", id: "zz" })).toBe(items);
    expect(removePin(items, frag)).toEqual([]);
  });
});

describe("fullBlockedBy", () => {
  it("blocks on content pins first, then on size, never while unknown", () => {
    const pinned = deriveBarState([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, frag]);
    expect(fullBlockedBy(pinned, false)).toBe("pins");
    const clean = deriveBarState([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, proj]);
    expect(fullBlockedBy(clean, false)).toBe("size");
    expect(fullBlockedBy(clean, true)).toBeNull();
    expect(fullBlockedBy(clean, undefined)).toBeNull();
  });
});
