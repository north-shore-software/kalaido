import {
  type ContextItem,
  itemsToSpec,
  specKey,
  specToItems,
} from "./chat";

describe("itemsToSpec", () => {
  test("maps pinned fragments to fragmentIds", () => {
    const items: ContextItem[] = [
      { kind: "Fragment", id: "f1", label: "A draft" },
      { kind: "Fragment", id: "f2", label: "Another" },
    ];
    expect(itemsToSpec(items)).toEqual({ fragmentIds: ["f1", "f2"] });
  });

  // Pins supplement the rules rather than replacing them — the backend resolves
  // the union — so a spec can carry both.
  test("carries pins alongside the rule-based criteria", () => {
    const items: ContextItem[] = [
      { kind: "Fragment", id: "f1", label: "A draft" },
      { kind: "Type", id: "note", label: "Note" },
      { kind: "Colour", id: "c1", label: "Urgent" },
    ];
    expect(itemsToSpec(items)).toEqual({
      fragmentIds: ["f1"],
      fragmentTypes: ["note"],
      colourIds: ["c1"],
    });
  });

  // An empty selection still means "everything", and a pin is a selection.
  test("a lone pin is not whole scope", () => {
    const spec = itemsToSpec([{ kind: "Fragment", id: "f1", label: "A draft" }]);
    expect(spec.wholeScope).toBeUndefined();
  });
});

describe("itemsToSpec focus", () => {
  test("splits focused items out of the background", () => {
    const items: ContextItem[] = [
      { kind: "Fragment", id: "f1", label: "The subject", focus: true },
      { kind: "Type", id: "note", label: "Note" },
    ];
    expect(itemsToSpec(items)).toEqual({
      fragmentTypes: ["note"],
      focus: { fragmentIds: ["f1"] },
    });
  });

  // The trap: whole scope is decided by the whole selection, not by what's left
  // after the focus is removed. Otherwise focusing your only item would quietly
  // pull the entire kalaidoscope in as background.
  test("focusing the only item does not turn the background into everything", () => {
    const spec = itemsToSpec([
      { kind: "Fragment", id: "f1", label: "The subject", focus: true },
    ]);
    expect(spec.wholeScope).toBeUndefined();
    expect(spec).toEqual({ focus: { fragmentIds: ["f1"] } });
  });

  test("an empty selection is still whole scope", () => {
    expect(itemsToSpec([])).toEqual({ wholeScope: true });
  });

  test("no focused items means no focus key", () => {
    const spec = itemsToSpec([{ kind: "Type", id: "note", label: "Note" }]);
    expect(spec.focus).toBeUndefined();
  });
});

describe("specToItems", () => {
  test("expands fragmentIds back into pinned items", () => {
    const items = specToItems({ fragmentIds: ["f1"], fragmentTypes: ["note"] });
    expect(items).toContainEqual({ kind: "Fragment", id: "f1", label: "f1" });
    expect(items).toContainEqual({ kind: "Type", id: "note", label: "note" });
  });

  test("round-trips a spec through items unchanged", () => {
    const spec = {
      fragmentIds: ["f1", "f2"],
      fragmentTypes: ["note"],
      colourIds: ["c1"],
      sourceProjectionIds: ["p1"],
      sourceReflectionIds: ["r1"],
    };
    expect(itemsToSpec(specToItems(spec))).toEqual(spec);
  });

  test("marks the focused half so the picker can render it", () => {
    const items = specToItems({
      fragmentTypes: ["note"],
      focus: { fragmentIds: ["f1"] },
    });
    expect(items).toContainEqual({
      kind: "Fragment",
      id: "f1",
      label: "f1",
      focus: true,
    });
    expect(items).toContainEqual({ kind: "Type", id: "note", label: "note" });
  });

  test("round-trips a focused spec unchanged", () => {
    const spec = {
      fragmentTypes: ["note"],
      colourIds: ["c1"],
      focus: { fragmentIds: ["f1"] },
    };
    expect(itemsToSpec(specToItems(spec))).toEqual(spec);
  });
});

describe("specKey", () => {
  // The key decides whether the chat re-sends its context, so a changed pin set
  // has to move it — otherwise the backend never learns about the new focus.
  test("changes when the pinned set changes", () => {
    expect(specKey({ fragmentIds: ["f1"] })).not.toBe(
      specKey({ fragmentIds: ["f2"] }),
    );
    expect(specKey({ fragmentIds: ["f1"] })).not.toBe(specKey({}));
  });

  test("ignores the order pins arrive in", () => {
    expect(specKey({ fragmentIds: ["f1", "f2"] })).toBe(
      specKey({ fragmentIds: ["f2", "f1"] }),
    );
  });

  // Refocusing moves an item between focus and background without changing what
  // is selected. If the key missed that, the chat would never re-send the spec
  // and the refocus would silently never reach the model.
  test("changes when an item is promoted to the focus", () => {
    const background = itemsToSpec([
      { kind: "Fragment", id: "f1", label: "x" },
    ]);
    const focused = itemsToSpec([
      { kind: "Fragment", id: "f1", label: "x", focus: true },
    ]);
    expect(specKey(background)).not.toBe(specKey(focused));
  });
});
