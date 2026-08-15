import { err, ok } from "neverthrow";
import { vi } from "vitest";

import type { EntityStatus } from "@/api/kalaidoscope/rotation";
import { findNextTarget } from "./next-target";

const { getRotation, getPendingCandidate, regenerateProjection } = vi.hoisted(
  () => ({
    getRotation: vi.fn(),
    getPendingCandidate: vi.fn(),
    regenerateProjection: vi.fn(),
  }),
);

vi.mock("@/api/kalaidoscope/rotation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/kalaidoscope/rotation")>()),
  getRotation,
}));

vi.mock("@/api/kalaidoscope/projections", () => ({
  getPendingCandidate,
  regenerateProjection,
}));

function plan(...statuses: Partial<EntityStatus>[]) {
  return ok({
    statuses: statuses.map((s, i) => ({
      id: `e${i}`,
      type: "projection" as const,
      ...s,
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPendingCandidate.mockResolvedValue(ok(null));
  regenerateProjection.mockResolvedValue(ok({ snapshotId: "generated" }));
});

describe("findNextTarget", () => {
  test("takes the first actionable entry, in the server's order", async () => {
    getRotation.mockResolvedValue(
      plan(
        { id: "blocked", blockedBy: ["upstream"] },
        { id: "fresh" },
        { id: "ready", newFragmentIds: ["f1"] },
        { id: "later", newFragmentIds: ["f2"] },
      ),
    );
    getPendingCandidate.mockResolvedValue(ok({ id: "cand" }));

    const res = await findNextTarget();

    expect(res._unsafeUnwrap()).toEqual({
      id: "ready",
      type: "projection",
      snapshotId: "cand",
    });
  });

  test("never picks something still waiting on an upstream", async () => {
    getRotation.mockResolvedValue(plan({ id: "blocked", blockedBy: ["up"] }));

    expect(await findNextTarget().then((r) => r._unsafeUnwrap())).toBeNull();
  });

  test("null when everything is up to date", async () => {
    getRotation.mockResolvedValue(plan({ id: "fresh" }));

    expect(await findNextTarget().then((r) => r._unsafeUnwrap())).toBeNull();
  });

  test("reuses a candidate that is already waiting", async () => {
    getRotation.mockResolvedValue(plan({ id: "ready", newFragmentIds: ["f"] }));
    getPendingCandidate.mockResolvedValue(ok({ id: "existing" }));

    const res = await findNextTarget();

    expect(res._unsafeUnwrap()).toMatchObject({ snapshotId: "existing" });
    expect(regenerateProjection).not.toHaveBeenCalled();
  });

  test("generates a candidate when there isn't one", async () => {
    getRotation.mockResolvedValue(plan({ id: "ready", newFragmentIds: ["f"] }));

    const res = await findNextTarget();

    expect(regenerateProjection).toHaveBeenCalledWith("ready");
    expect(res._unsafeUnwrap()).toMatchObject({ snapshotId: "generated" });
  });

  test("reflections come back without a candidate", async () => {
    getRotation.mockResolvedValue(
      plan({ id: "r1", type: "reflection", newFragmentIds: ["f"] }),
    );

    expect(await findNextTarget().then((r) => r._unsafeUnwrap())).toEqual({
      id: "r1",
      type: "reflection",
    });
    expect(regenerateProjection).not.toHaveBeenCalled();
  });

  test("skips what the caller asks it to", async () => {
    getRotation.mockResolvedValue(
      plan(
        { id: "a", newFragmentIds: ["f"] },
        { id: "b", newFragmentIds: ["f"] },
      ),
    );

    const res = await findNextTarget({ skip: ["a"] });

    expect(res._unsafeUnwrap()).toMatchObject({ id: "b" });
  });

  test("propagates a failure to read the plan", async () => {
    getRotation.mockResolvedValue(err(new Error("offline")));

    const res = await findNextTarget();

    expect(res._unsafeUnwrapErr().message).toBe("offline");
  });
});
