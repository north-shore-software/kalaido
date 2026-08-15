import type { EntityStatus } from "@/api/kalaidoscope/rotation";
import { getProjectionStatus } from "./status";

function status(partial: Partial<EntityStatus>): EntityStatus {
  return { id: "x", type: "projection", ...partial };
}

describe("getProjectionStatus", () => {
  test("stable when the plan reports no delta", () => {
    expect(getProjectionStatus(status({}), false).status).toBe("stable");
  });

  test("a pending candidate outranks everything", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1"], blockedBy: ["p1"] }),
      true,
    );
    expect(info.status).toBe("pending");
  });

  test("blocked when an upstream is not itself up to date", () => {
    const info = getProjectionStatus(status({ blockedBy: ["p1"] }), false);
    expect(info.status).toBe("blocked");
    expect(info.blockedBy).toEqual(["p1"]);
  });

  // The bug: an approved upstream leaves staleDependencies set. That used to
  // read as blocked; it means this projection is ready to regenerate.
  test("stale, not blocked, when an upstream has published", () => {
    const info = getProjectionStatus(
      status({ staleDependencies: ["p1"] }),
      false,
    );
    expect(info.status).toBe("stale");
    expect(info.blockedBy).toEqual([]);
  });

  test("stale on new fragments, carrying the entropy count", () => {
    const info = getProjectionStatus(
      status({ newFragmentIds: ["f1", "f2"] }),
      false,
    );
    expect(info.status).toBe("stale");
    expect(info.entropy).toBe(2);
  });

  test("stale on a due window", () => {
    const info = getProjectionStatus(
      status({ pendingWindows: [{ start: "", end: "" }] }),
      false,
    );
    expect(info.status).toBe("stale");
  });

  test("no plan entry reads as stable", () => {
    expect(getProjectionStatus(undefined, false).status).toBe("stable");
  });
});
