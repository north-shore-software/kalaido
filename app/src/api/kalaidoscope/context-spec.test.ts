import {
  type ContextItem,
  diffContextSpecs,
  itemsToSpec,
  SUMMARIES_ITEM,
  setScopeMode,
  specKey,
  specToItems,
  WHOLE_SCOPE_ITEM,
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

  test("a lone pin is not whole scope", () => {
    const spec = itemsToSpec([
      { kind: "Fragment", id: "f1", label: "A draft" },
    ]);
    expect(spec.wholeScope).toBeUndefined();
  });
});

describe("itemsToSpec scope modes", () => {
  // Off with nothing pinned is a real state now: it clears the context.
  test("an empty selection is scope off, nothing pinned", () => {
    expect(itemsToSpec([])).toEqual({});
  });

  test("the marker alone is whole scope in full", () => {
    expect(itemsToSpec([WHOLE_SCOPE_ITEM])).toEqual({ wholeScope: true });
  });

  test("summaries with pins carries both flags and the pins", () => {
    expect(
      itemsToSpec([
        WHOLE_SCOPE_ITEM,
        SUMMARIES_ITEM,
        { kind: "Fragment", id: "f1", label: "A draft" },
        { kind: "Colour", id: "c1", label: "Urgent" },
      ]),
    ).toEqual({
      wholeScope: true,
      summaries: true,
      fragmentIds: ["f1"],
      colourIds: ["c1"],
    });
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

  test("round-trips a whole scope carrying source compositions", () => {
    // The case the marker exists for. Without it this spec would come back as
    // "just this projection", silently dropping every fragment in the scope.
    const spec = {
      wholeScope: true,
      sourceProjectionIds: ["p1"],
    };
    expect(itemsToSpec(specToItems(spec))).toEqual(spec);
  });

  test("round-trips a bare whole scope", () => {
    expect(itemsToSpec(specToItems({ wholeScope: true }))).toEqual({
      wholeScope: true,
    });
  });
});

describe("specKey", () => {
  // The key decides whether the chat re-sends its context, so a changed pin set
  // has to move it — otherwise the backend never learns about the change.
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

describe("diffContextSpecs", () => {
  test("everything is added against a null previous spec", () => {
    const delta = diffContextSpecs(null, {
      fragmentTypes: ["note"],
      fragmentIds: ["f1"],
    });
    expect(delta.added.map((it) => `${it.kind}:${it.id}`)).toEqual([
      "Type:note",
      "Fragment:f1",
    ]);
    expect(delta.removed).toEqual([]);
  });

  test("diffs on kind+id in both directions", () => {
    const delta = diffContextSpecs(
      { fragmentTypes: ["note", "email"], colourIds: ["c1"] },
      { fragmentTypes: ["note"], sourceProjectionIds: ["p1"] },
    );
    expect(delta.added.map((it) => `${it.kind}:${it.id}`)).toEqual([
      "Projection:p1",
    ]);
    expect(delta.removed.map((it) => `${it.kind}:${it.id}`)).toEqual([
      "Colour:c1",
      "Type:email",
    ]);
  });

  test("an unchanged spec diffs to nothing", () => {
    const spec = { wholeScope: true, fragmentIds: ["f1"] };
    const delta = diffContextSpecs(spec, { ...spec });
    expect(delta).toEqual({ added: [], removed: [] });
  });

  test("the whole-scope marker takes part in the diff", () => {
    const delta = diffContextSpecs(
      { wholeScope: true },
      {
        fragmentTypes: ["note"],
      },
    );
    expect(delta.added.map((it) => it.kind)).toEqual(["Type"]);
    expect(delta.removed.map((it) => it.kind)).toEqual(["WholeScope"]);
  });
});

describe("summaries marker", () => {
  test("maps the marker to spec.summaries alongside whole scope", () => {
    expect(itemsToSpec([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM])).toEqual({
      wholeScope: true,
      summaries: true,
    });
  });

  test("round-trips through specToItems", () => {
    const spec = { wholeScope: true, summaries: true };
    expect(itemsToSpec(specToItems(spec))).toEqual(spec);
    expect(specToItems(spec)).toContainEqual(SUMMARIES_ITEM);
  });

  test("specKey changes on the flag alone", () => {
    expect(specKey({ wholeScope: true })).not.toBe(
      specKey({ wholeScope: true, summaries: true }),
    );
  });

  test("diffContextSpecs reports the marker as added", () => {
    const delta = diffContextSpecs(
      { wholeScope: true },
      { wholeScope: true, summaries: true },
    );
    expect(delta.added).toEqual([SUMMARIES_ITEM]);
    expect(delta.removed).toEqual([]);
  });
});

describe("setScopeMode on the wire", () => {
  test("every mode round-trips through specToItems with its pins", () => {
    const pin: ContextItem = { kind: "Fragment", id: "f1", label: "A draft" };
    for (const mode of ["full", "summaries", "off"] as const) {
      const items = setScopeMode([WHOLE_SCOPE_ITEM, SUMMARIES_ITEM, pin], mode);
      const spec = itemsToSpec(items);
      expect(itemsToSpec(specToItems(spec))).toEqual(spec);
      expect(spec.fragmentIds).toEqual(["f1"]);
    }
  });
});
