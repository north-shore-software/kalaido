import type { EntityStatus } from "@kalaido/client/kalaidoscope/freshness";
import { getProjectionStatus } from "./status";

function status(partial: Partial<EntityStatus>): EntityStatus {
  return { id: "x", type: "projection", ...partial };
}

describe("getProjectionStatus", () => {
  test("stable when freshness reports no delta", () => {
    expect(getProjectionStatus(status({}), false).status).toBe("stable");
  });

  test("a pending candidate outranks staleness", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1"], staleDependencies: ["p1"] }),
      true,
    );
    expect(info.status).toBe("pending");
  });

  test("stale with staleDependencies when an upstream has published", () => {
    const info = getProjectionStatus(
      status({ staleDependencies: ["p1"] }),
      false,
    );
    expect(info.status).toBe("stale");
    expect(info.staleDependencies).toEqual(["p1"]);
  });

  test("stale on new fragments, carrying the entropy count", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1", "f2"] }),
      false,
    );
    expect(info.status).toBe("stale");
    expect(info.entropy).toBe(2);
    expect(info.staleDependencies).toEqual([]);
  });

  test("stale on a due window", () => {
    const info = getProjectionStatus(
      status({ pendingWindows: [{ start: "", end: "" }] }),
      false,
    );
    expect(info.status).toBe("stale");
  });

  test("no status entry reads as stable", () => {
    expect(getProjectionStatus(undefined, false).status).toBe("stable");
  });

  test("a running generation outranks even a pending candidate", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1"], staleDependencies: ["p1"] }),
      true,
      { generating: true },
    );
    expect(info.status).toBe("generating");
  });

  test("a missing lens reads as preparing, not stale", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1"], staleDependencies: ["p1"] }),
      false,
      { lensMissing: true },
    );
    expect(info.status).toBe("preparing");
  });

  test("a pending candidate outranks a missing lens", () => {
    const info = getProjectionStatus(status({}), true, { lensMissing: true });
    expect(info.status).toBe("pending");
  });

  test("pending untouched outdated candidate resolves to stale", () => {
    const info = getProjectionStatus(
      status({
        candidate: { id: "c1", outdated: true, engaged: false },
      }),
      true,
    );
    expect(info.status).toBe("stale");
    expect(info.candidateOutdated).toBe(true);
    expect(info.candidateEngaged).toBe(false);
  });

  test("pending engaged outdated candidate remains pending", () => {
    const info = getProjectionStatus(
      status({
        candidate: { id: "c1", outdated: true, engaged: true },
      }),
      true,
    );
    expect(info.status).toBe("pending");
    expect(info.candidateOutdated).toBe(true);
    expect(info.candidateEngaged).toBe(true);
  });

  test("pending current candidate remains pending", () => {
    const info = getProjectionStatus(
      status({
        candidate: { id: "c1", outdated: false, engaged: false },
      }),
      true,
    );
    expect(info.status).toBe("pending");
    expect(info.candidateOutdated).toBe(false);
  });
});
