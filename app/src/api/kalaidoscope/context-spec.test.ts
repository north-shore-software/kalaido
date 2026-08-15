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
});
