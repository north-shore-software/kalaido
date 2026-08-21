import type { ContextSources } from "@/hooks/use-context-sources";
import { resolveSources } from "./sources";

const sources: ContextSources = {
  types: [],
  projections: [{ id: "p1", name: "Pricing model" }],
  reflections: [{ id: "r1", name: "Weekly standups" }],
  colours: [{ id: "c1", name: "Business", value: "#10b981" }],
  loading: false,
  error: null,
};

describe("resolveSources", () => {
  test("null spec and whole scope resolve to nothing", () => {
    expect(resolveSources(null, sources)).toEqual([]);
    expect(resolveSources({ wholeScope: true }, sources)).toEqual([]);
  });

  test("orders colours, then projections, then reflections", () => {
    const items = resolveSources(
      {
        sourceReflectionIds: ["r1"],
        sourceProjectionIds: ["p1"],
        colourIds: ["c1"],
      },
      sources,
    );
    expect(items).toEqual([
      { kind: "Colour", id: "c1", label: "Business", value: "#10b981" },
      { kind: "Projection", id: "p1", label: "Pricing model" },
      { kind: "Reflection", id: "r1", label: "Weekly standups" },
    ]);
  });

  test("falls back to the id when a name is unknown", () => {
    const items = resolveSources({ sourceProjectionIds: ["gone"] }, sources);
    expect(items[0].label).toBe("gone");
  });
});
