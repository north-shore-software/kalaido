import { itemsToSpec } from "@/api/kalaidoscope/chat";
import type { ContextItem } from "@/api/kalaidoscope/chat";
import { refocusedContext } from "./refocus";

const colour: ContextItem = { kind: "Colour", id: "c1", label: "Urgent" };
const type: ContextItem = { kind: "Type", id: "note", label: "Note" };

describe("refocusedContext", () => {
  test("the saved fragment becomes the subject", () => {
    const [first] = refocusedContext([], "f1");
    expect(first).toEqual({
      kind: "Fragment",
      id: "f1",
      label: "f1",
      focus: true,
    });
  });

  test("carries the previous selection across as background", () => {
    const next = refocusedContext([colour, type], "f1");
    expect(next).toHaveLength(3);
    expect(next.slice(1)).toEqual([
      { ...colour, focus: false },
      { ...type, focus: false },
    ]);
  });

  // Only one thing is the subject at a time — that's what makes it a refocus
  // rather than a pile-up.
  test("demotes a previous focus", () => {
    const previous: ContextItem[] = [
      { kind: "Fragment", id: "f0", label: "f0", focus: true },
      colour,
    ];
    const next = refocusedContext(previous, "f1");
    expect(next.filter((it) => it.focus)).toEqual([
      { kind: "Fragment", id: "f1", label: "f1", focus: true },
    ]);
    expect(next).toContainEqual({
      kind: "Fragment",
      id: "f0",
      label: "f0",
      focus: false,
    });
  });

  test("refocusing onto the same fragment twice doesn't duplicate it", () => {
    const once = refocusedContext([colour], "f1");
    const twice = refocusedContext(once, "f1");
    expect(twice.filter((it) => it.id === "f1")).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  // The whole point: the resulting spec has to name a focus, or the backend
  // renders it as one undifferentiated pile.
  test("produces a spec the backend reads as focused", () => {
    const spec = itemsToSpec(refocusedContext([colour], "f1"));
    expect(spec).toEqual({
      colourIds: ["c1"],
      focus: { fragmentIds: ["f1"] },
    });
  });

  // A refocus from a whole-scope chat: nothing was selected, so there is no
  // background to carry — and the result must not read as "everything".
  test("a refocus from an unfiltered chat narrows rather than widens", () => {
    const spec = itemsToSpec(refocusedContext([], "f1"));
    expect(spec).toEqual({ focus: { fragmentIds: ["f1"] } });
    expect(spec.wholeScope).toBeUndefined();
  });
});
