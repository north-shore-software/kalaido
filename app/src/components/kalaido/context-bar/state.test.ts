import { describe, expect, it } from "vitest";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import {
  SUMMARIES_ITEM,
  WHOLE_SCOPE_ITEM,
} from "@/api/kalaidoscope/context-items";
import {
  type BarSources,
  deriveBarState,
  isChecked,
  removePin,
  summarizeChecked,
  toggleColour,
  toggleType,
} from "./state";

const sources: BarSources = {
  types: [
    { id: "note", label: "Note" },
    { id: "email", label: "Email" },
    { id: "voice", label: "Voice" },
  ],
  colours: [
    { id: "c1", label: "Work", value: "#f00" },
    { id: "c2", label: "Personal", value: "#0f0" },
  ],
};

const pin: ContextItem = { kind: "Fragment", id: "f1", label: "standup" };

/** All types minus `minus`, plus all colours — the enumerated form of one uncheck. */
function enumeratedWithout(minusType: string): ContextItem[] {
  return [
    ...sources.types
      .filter((o) => o.id !== minusType)
      .map((o): ContextItem => ({ kind: "Type", id: o.id, label: o.label })),
    ...sources.colours.map(
      (o): ContextItem => ({
        kind: "Colour",
        id: o.id,
        label: o.label,
        value: o.value,
      }),
    ),
  ];
}

describe("deriveBarState", () => {
  it("treats empty and marker selections as whole scope", () => {
    expect(deriveBarState([]).allScope).toBe(true);
    expect(deriveBarState([WHOLE_SCOPE_ITEM]).allScope).toBe(true);
    expect(isChecked(deriveBarState([]), "Type", "email")).toBe(true);
    expect(isChecked(deriveBarState([]), "Colour", "c1")).toBe(true);
  });

  it("lets the marker win over stray criteria items", () => {
    const state = deriveBarState([
      WHOLE_SCOPE_ITEM,
      { kind: "Colour", id: "c1", label: "Work" },
    ]);
    expect(state.allScope).toBe(true);
    expect(isChecked(state, "Colour", "c2")).toBe(true);
  });

  it("derives sets and ordered pins from an enumerated selection", () => {
    const state = deriveBarState([
      { kind: "Type", id: "note", label: "Note" },
      { kind: "Colour", id: "c2", label: "Personal" },
      pin,
      { kind: "Projection", id: "p1", label: "weekly" },
    ]);
    expect(state.allScope).toBe(false);
    expect(isChecked(state, "Type", "note")).toBe(true);
    expect(isChecked(state, "Type", "email")).toBe(false);
    expect(isChecked(state, "Colour", "c2")).toBe(true);
    expect(isChecked(state, "Colour", "c1")).toBe(false);
    expect(state.pins.map((p) => p.id)).toEqual(["f1", "p1"]);
  });
});

describe("toggle from whole scope", () => {
  it("enumerates the full universe minus the unchecked type", () => {
    expect(toggleType([], "email", sources)).toEqual(
      enumeratedWithout("email"),
    );
  });

  it("keeps pins and drops the marker when enumerating", () => {
    const next = toggleType([WHOLE_SCOPE_ITEM, pin], "email", sources);
    expect(next).toEqual([...enumeratedWithout("email"), pin]);
  });

  it("carries colour values into the enumerated items", () => {
    const next = toggleColour([], "c1", sources);
    const colours = next.filter((it) => it.kind === "Colour");
    expect(colours).toEqual([
      { kind: "Colour", id: "c2", label: "Personal", value: "#0f0" },
    ]);
    expect(next.filter((it) => it.kind === "Type")).toHaveLength(3);
  });

  it("ignores an unknown id", () => {
    const items: ContextItem[] = [];
    expect(toggleType(items, "nope", sources)).toBe(items);
  });
});

describe("toggle while enumerated", () => {
  it("checks and unchecks entries", () => {
    const start = enumeratedWithout("email");
    const fewer = toggleType(start, "voice", sources);
    expect(deriveBarState(fewer).checkedTypes).toEqual(new Set(["note"]));
    expect(isChecked(deriveBarState(fewer), "Colour", "c1")).toBe(true);
  });

  it("collapses to empty when both lists are re-checked to full", () => {
    expect(toggleType(enumeratedWithout("email"), "email", sources)).toEqual(
      [],
    );
  });

  it("collapses to marker + pins when pins are present", () => {
    const start = [...enumeratedWithout("email"), pin];
    expect(toggleType(start, "email", sources)).toEqual([
      WHOLE_SCOPE_ITEM,
      pin,
    ]);
  });

  it("stays enumerated while only one list is full", () => {
    const oneColourOff = toggleColour([], "c1", sources);
    // All types are checked, one colour is not: identical scope on the wire,
    // but the unchecked box must persist in the UI.
    expect(deriveBarState(oneColourOff).allScope).toBe(false);
    expect(oneColourOff.filter((it) => it.kind === "Type")).toHaveLength(3);
  });

  it("unchecking the last entry resets to the default empty selection", () => {
    const onlyNote: ContextItem[] = [{ kind: "Type", id: "note", label: "N" }];
    expect(toggleType(onlyNote, "note", sources)).toEqual([]);
  });

  it("unchecking the last entry keeps pins when present", () => {
    const next = toggleType(
      [{ kind: "Type", id: "note", label: "N" }, pin],
      "note",
      sources,
    );
    expect(next).toEqual([pin]);
  });

  it("preserves a stale checked id and its label while enumerated", () => {
    const stale: ContextItem = { kind: "Colour", id: "gone", label: "Old" };
    const start: ContextItem[] = [
      { kind: "Type", id: "note", label: "Note" },
      stale,
    ];
    const next = toggleType(start, "email", sources);
    expect(next).toContainEqual(stale);
  });

  it("lets a stale id be unchecked, and ignores it in the collapse check", () => {
    const stale: ContextItem = { kind: "Colour", id: "gone", label: "Old" };
    const start = [...enumeratedWithout("email"), stale];
    const dropped = toggleColour(start, "gone", sources);
    expect(dropped).not.toContainEqual(stale);
    // Re-checking the missing type collapses despite the stale extra.
    expect(toggleType(start, "email", sources)).toEqual([]);
  });
});

describe("removePin", () => {
  it("removes by kind+id and collapses a bare marker to empty", () => {
    expect(removePin([WHOLE_SCOPE_ITEM, pin], pin)).toEqual([]);
    const enumerated = [...enumeratedWithout("email"), pin];
    expect(removePin(enumerated, pin)).toEqual(enumeratedWithout("email"));
    expect(removePin(enumerated, { kind: "Fragment", id: "zz" })).toBe(
      enumerated,
    );
  });
});

describe("summarizeChecked", () => {
  it("captions all-checked, partial, and full-by-enumeration states", () => {
    expect(summarizeChecked(deriveBarState([]), "Type", sources.types)).toBe(
      "all",
    );
    const oneOff = deriveBarState(toggleType([], "email", sources));
    expect(summarizeChecked(oneOff, "Type", sources.types)).toBe("2/3");
    expect(summarizeChecked(oneOff, "Colour", sources.colours)).toBe("all");
  });
});

describe("summaries marker", () => {
  it("is neither a pin nor a check", () => {
    const state = deriveBarState([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, pin]);
    expect(state.allScope).toBe(true);
    expect(state.pins).toEqual([pin]);
  });

  it("is dropped on the first uncheck", () => {
    const next = toggleType(
      [WHOLE_SCOPE_ITEM, SUMMARIES_ITEM],
      "email",
      sources,
    );
    expect(next).toEqual(enumeratedWithout("email"));
  });

  it("survives a round trip back to whole scope", () => {
    const enumerated = toggleType(
      [WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, pin],
      "email",
      sources,
    );
    expect(enumerated.some((it) => it.kind === "Summaries")).toBe(false);
    // The marker only comes back through the toggle, not through re-checking:
    // enumerating is where it is dropped for good.
    expect(toggleType(enumerated, "email", sources)).toEqual([
      WHOLE_SCOPE_ITEM,
      pin,
    ]);
  });

  it("keeps the marker pair when the last pin is removed", () => {
    expect(removePin([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, pin], pin)).toEqual([
      WHOLE_SCOPE_ITEM,
      SUMMARIES_ITEM,
    ]);
  });
});
