import type { EntityStatus } from "@/api/kalaidoscope/rotation";
import { describeDelta } from "./describe-delta";

const names: Record<string, string> = {
  p1: "Weekly digest",
  p2: "Standups",
  p3: "Hiring notes",
  p4: "Launch log",
};
const nameFor = (id: string) => names[id] ?? "an upstream";

function status(partial: Partial<EntityStatus>): EntityStatus {
  return { id: "x", type: "projection", ...partial };
}

describe("describeDelta", () => {
  test("names the upstreams it is waiting on", () => {
    expect(describeDelta(status({ blockedBy: ["p1"] }), nameFor)).toBe(
      "waiting on Weekly digest",
    );
    expect(describeDelta(status({ blockedBy: ["p1", "p2"] }), nameFor)).toBe(
      "waiting on Weekly digest and Standups",
    );
  });

  test("caps long upstream lists", () => {
    expect(
      describeDelta(status({ blockedBy: ["p1", "p2", "p3", "p4"] }), nameFor),
    ).toBe("waiting on Weekly digest, Standups and 2 more");
  });

  // The bug: an upstream that has been approved leaves staleDependencies set,
  // which used to read as "blocked upstream" forever. It is now the opposite —
  // work that can be done right now.
  test("an upstream that published is stale, not blocked", () => {
    expect(describeDelta(status({ staleDependencies: ["p1"] }), nameFor)).toBe(
      "Weekly digest updated",
    );
  });

  test("combines fragment, window and upstream deltas", () => {
    expect(
      describeDelta(
        status({
          newFragmentIds: ["f1", "f2"],
          pendingWindows: [{ start: "", end: "" }],
          staleDependencies: ["p2"],
        }),
        nameFor,
      ),
    ).toBe("2 new fragments · 1 window due · Standups updated");
  });

  test("blocked takes precedence over the rest", () => {
    expect(
      describeDelta(
        status({ newFragmentIds: ["f1"], blockedBy: ["p1"] }),
        nameFor,
      ),
    ).toBe("waiting on Weekly digest");
  });

  test("falls back when the plan says nothing specific", () => {
    expect(describeDelta(status({}), nameFor)).toBe("needs refresh");
  });

  test("falls back to a generic name for an unknown upstream", () => {
    expect(describeDelta(status({ blockedBy: ["gone"] }), nameFor)).toBe(
      "waiting on an upstream",
    );
  });
});
