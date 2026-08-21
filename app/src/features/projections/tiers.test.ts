import type { ProjectionResponse } from "@/api/kalaidoscope/types";
import { tierProjections } from "./tiers";

function proj(
  id: string,
  sourceProjectionIds: string[] = [],
  sourceReflectionIds: string[] = [],
): ProjectionResponse {
  return {
    id,
    current_context_spec: { sourceProjectionIds, sourceReflectionIds },
  } as unknown as ProjectionResponse;
}

function ids(list: ProjectionResponse[]): string[] {
  return list.map((p) => p.id);
}

describe("tierProjections", () => {
  test("no upstreams is direct", () => {
    const t = tierProjections([proj("a")]);
    expect(ids(t.direct)).toEqual(["a"]);
    expect(t.derived).toEqual([]);
    expect(t.composite).toEqual([]);
  });

  test("one layer beneath is derived", () => {
    const t = tierProjections([proj("a"), proj("b", ["a"])]);
    expect(ids(t.direct)).toEqual(["a"]);
    expect(ids(t.derived)).toEqual(["b"]);
  });

  test("a reflection upstream counts as a layer", () => {
    const t = tierProjections([proj("a", [], ["r1"])]);
    expect(ids(t.derived)).toEqual(["a"]);
  });

  test("anything two or more layers deep is composite", () => {
    const t = tierProjections([
      proj("a"),
      proj("b", ["a"]),
      proj("c", ["b"]),
      proj("d", ["c"]),
    ]);
    expect(ids(t.direct)).toEqual(["a"]);
    expect(ids(t.derived)).toEqual(["b"]);
    expect(ids(t.composite)).toEqual(["c", "d"]);
  });

  test("depth is the deepest upstream, not the shallowest", () => {
    const t = tierProjections([
      proj("leaf"),
      proj("mid", ["leaf"]),
      proj("top", ["leaf", "mid"]),
    ]);
    expect(ids(t.composite)).toEqual(["top"]);
  });

  test("projection over a projection over a reflection is composite", () => {
    const t = tierProjections([proj("b", [], ["r1"]), proj("c", ["b"])]);
    expect(ids(t.derived)).toEqual(["b"]);
    expect(ids(t.composite)).toEqual(["c"]);
  });

  test("an unknown upstream id is treated as a leaf", () => {
    const t = tierProjections([proj("a", ["missing"])]);
    expect(ids(t.derived)).toEqual(["a"]);
  });

  test("a cycle terminates", () => {
    const t = tierProjections([proj("a", ["b"]), proj("b", ["a"])]);
    expect(t.direct.length + t.derived.length + t.composite.length).toBe(2);
  });

  test("input order is preserved within a tier", () => {
    const t = tierProjections([proj("z"), proj("y"), proj("x")]);
    expect(ids(t.direct)).toEqual(["z", "y", "x"]);
  });

  test("a null spec is direct", () => {
    const p = {
      id: "a",
      current_context_spec: null,
    } as unknown as ProjectionResponse;
    expect(ids(tierProjections([p]).direct)).toEqual(["a"]);
  });
});
