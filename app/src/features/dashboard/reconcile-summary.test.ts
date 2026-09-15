import type { EntityStatus } from "@/api/kalaidoscope/rotation";
import { joinNames, summarizeReconcile } from "./reconcile-summary";

const nameById = new Map([
  ["p1", "Weekly digest"],
  ["p2", "Standups"],
  ["r1", "Month in review"],
]);

function status(
  partial: Partial<EntityStatus> & { id: string },
): EntityStatus {
  return { type: "projection", ...partial };
}

describe("summarizeReconcile", () => {
  test("counts projections, how many are ready, and reflections separately", () => {
    const summary = summarizeReconcile(
      [
        status({ id: "r1", type: "reflection", newFragmentIds: ["f1"] }),
        status({ id: "p1", newFragmentIds: ["f1", "f2"] }),
        status({ id: "p2", blockedBy: ["p1"] }),
        status({ id: "p3", upToDateSnapshotId: "s3" }),
      ],
      { candidateByProjection: new Map([["p1", "c1"]]), nameById },
    );
    expect(summary).toEqual({
      projections: 2,
      ready: 1,
      reflections: 1,
      newFragments: 2,
      names: ["Weekly digest", "Standups"],
    });
  });

  test("blocked projections count: the wave prepares them too", () => {
    const summary = summarizeReconcile(
      [status({ id: "p2", blockedBy: ["p1"] })],
      {
        candidateByProjection: new Map([["p2", "c2"]]),
        nameById,
      },
    );
    expect(summary.projections).toBe(1);
    expect(summary.ready).toBe(1);
  });

  test("an up-to-date workspace is all zeros", () => {
    const summary = summarizeReconcile(
      [status({ id: "p1", upToDateSnapshotId: "s1" })],
      { candidateByProjection: new Map(), nameById },
    );
    expect(summary).toEqual({
      projections: 0,
      ready: 0,
      reflections: 0,
      newFragments: 0,
      names: [],
    });
  });

  test("names fall back when the entity row has not loaded", () => {
    const summary = summarizeReconcile(
      [status({ id: "ghost", newFragmentIds: ["f1"] })],
      { candidateByProjection: new Map(), nameById },
    );
    expect(summary.names).toEqual(["Untitled projection"]);
  });
});

describe("joinNames", () => {
  test("reads naturally up to two names", () => {
    expect(joinNames(["Weekly digest"])).toBe("Weekly digest");
    expect(joinNames(["Weekly digest", "Standups"])).toBe(
      "Weekly digest and Standups",
    );
  });

  test("caps long lists", () => {
    expect(joinNames(["A", "B", "C", "D"])).toBe("A, B and 2 more");
  });
});
