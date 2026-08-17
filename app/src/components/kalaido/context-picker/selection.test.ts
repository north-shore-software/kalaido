import { describe, expect, test } from "vitest";

import { itemsToSpec } from "@/api/kalaidoscope/chat";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { itemsToSelection, selectionToItems } from "./selection";
import type { ContextSelection } from "./types";

const sel = (over: Partial<ContextSelection>): ContextSelection => ({
  mode: "except",
  criteria: [],
  sources: [],
  focus: [],
  ...over,
});

const spec = (s: ContextSelection) => itemsToSpec(selectionToItems(s));

describe("selectionToItems", () => {
  test("an untouched funnel is the whole scope", () => {
    expect(spec(sel({}))).toEqual({ wholeScope: true });
  });

  // The bug the whole-scope marker exists to prevent: "everything, plus this
  // projection" must not serialise as "this projection and no fragments".
  test("everything-plus-a-source keeps the fragment scope", () => {
    const s = sel({
      sources: [{ kind: "Projection", id: "p1", label: "PRD" }],
    });
    expect(spec(s)).toEqual({ wholeScope: true, sourceProjectionIds: ["p1"] });
  });

  test("only-mode narrows to the named criteria", () => {
    const s = sel({
      mode: "only",
      criteria: [{ kind: "Type", id: "note", label: "Note" }],
    });
    expect(spec(s)).toEqual({ fragmentTypes: ["note"] });
  });

  test("none-mode contributes no fragments at all", () => {
    const s = sel({
      mode: "none",
      sources: [{ kind: "Reflection", id: "r1", label: "Standup", lastN: 7 }],
    });
    expect(spec(s)).toEqual({ sourceReflectionIds: ["r1"] });
  });

  // Exclusion has no representation on the wire. Dropping the exclusions is
  // lossy; emitting them as inclusions would be *wrong*, which is worse.
  test("exclusions are dropped rather than inverted into inclusions", () => {
    const s = sel({
      mode: "except",
      criteria: [{ kind: "Colour", id: "c1", label: "Personal" }],
    });
    expect(spec(s)).toEqual({ wholeScope: true });
  });

  test("focus travels as the focused half", () => {
    const s = sel({
      focus: [{ kind: "Fragment", id: "f1", label: "Brief" }],
    });
    expect(spec(s)).toEqual({
      wholeScope: true,
      focus: { fragmentIds: ["f1"] },
    });
  });
});

describe("itemsToSelection", () => {
  test("a stated whole scope comes back as except", () => {
    const items: ContextItem[] = [
      { kind: "WholeScope", id: "*", label: "Whole scope" },
      { kind: "Projection", id: "p1", label: "PRD" },
    ];
    const s = itemsToSelection(items);
    expect(s.mode).toBe("except");
    expect(s.sources).toHaveLength(1);
  });

  test("fragment criteria without a marker infer only-mode", () => {
    const s = itemsToSelection([{ kind: "Type", id: "note", label: "Note" }]);
    expect(s.mode).toBe("only");
  });

  // Legacy specs: sources alone always meant "just these syntheses".
  test("sources alone infer none-mode", () => {
    const s = itemsToSelection([
      { kind: "Reflection", id: "r1", label: "Standup" },
    ]);
    expect(s.mode).toBe("none");
    expect(s.sources[0]?.lastN).toBeDefined();
  });

  test("round-trips a funnel selection through the wire format", () => {
    const s = sel({
      mode: "only",
      criteria: [
        { kind: "Type", id: "note", label: "Note" },
        { kind: "Colour", id: "c1", label: "Urgent" },
      ],
      sources: [{ kind: "Projection", id: "p1", label: "PRD" }],
      focus: [{ kind: "Fragment", id: "f1", label: "Brief" }],
    });
    expect(spec(itemsToSelection(selectionToItems(s)))).toEqual(spec(s));
  });
});
