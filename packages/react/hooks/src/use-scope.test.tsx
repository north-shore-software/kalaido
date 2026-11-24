import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { snapshot } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  createScope,
  type ScopeHandlers,
  type StateHandle,
  useScope,
} from "./use-scope";

type RootState = {
  count: number;
  label: string;
  secret: string;
  items: { id: number; name: string }[];
};

type RootEvent =
  | { type: "increment"; by: number }
  | { type: "setLabel"; label: string }
  | { type: "addItem"; name: string }
  | { type: "asyncIncrement"; by: number }
  | { type: "reset" };

function makeRoot() {
  const handlers: ScopeHandlers<RootState, RootEvent> = {
    increment: (s, e) => {
      s.count += e.by;
    },
    setLabel: (s, e) => {
      s.label = e.label;
    },
    addItem: (s, e) => {
      s.items.push({ id: s.items.length + 1, name: e.name });
    },
    asyncIncrement: async (s, e) => {
      await Promise.resolve();
      s.count += e.by;
    },
    reset: (s) => {
      s.count = 0;
      s.label = "initial";
      s.items = [];
    },
  };

  return createScope({
    initial: (): RootState => ({
      count: 0,
      label: "initial",
      secret: "top-secret",
      items: [{ id: 1, name: "first" }],
    }),
    handlers,
  });
}

describe("createScope", () => {
  test("owns state and updates synchronously via handlers", async () => {
    const root = makeRoot();
    expect(snapshot(root.state)).toEqual({
      count: 0,
      label: "initial",
      secret: "top-secret",
      items: [{ id: 1, name: "first" }],
    });

    await root.dispatch({ type: "increment", by: 3 });
    expect(root.state.count).toBe(3);

    await root.dispatch({ type: "asyncIncrement", by: 4 });
    expect(root.state.count).toBe(7);

    await root.dispatch({ type: "addItem", name: "second" });
    expect(root.state.items).toEqual([
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ]);

    root.dispose();
  });

  test("rejects direct runtime mutation of exposed state (top-level and nested)", async () => {
    const root = makeRoot();

    expect(() => {
      // @ts-expect-error state is readonly
      root.state.count = 999;
    }).toThrow(TypeError);
    expect(root.state.count).toBe(0);

    expect(() => {
      (root.state as Record<string, unknown>).injected = true;
    }).toThrow(TypeError);
    expect("injected" in root.state).toBe(false);

    expect(() => {
      // @ts-expect-error nested arrays are deeply frozen
      root.state.items.push({ id: 99, name: "bad" });
    }).toThrow(TypeError);
    expect(root.state.items).toHaveLength(1);

    // Owner handlers still work after rejected writes
    await root.dispatch({ type: "increment", by: 1 });
    expect(root.state.count).toBe(1);

    root.dispose();
  });

  test("narrows state keys and events at compile time and runtime", async () => {
    const root = makeRoot();
    const child = createScope({
      from: root,
      state: ["count"],
      events: ["increment"],
    });

    // Only granted keys exist on the narrowed proxy
    expect(Object.keys(child.state)).toEqual(["count"]);
    expect("secret" in child.state).toBe(false);
    expect("label" in child.state).toBe(false);
    expect(child.state.count).toBe(0);

    // Granted event updates parent and syncs back into child synchronously
    await child.dispatch({ type: "increment", by: 5 });
    expect(root.state.count).toBe(5);
    expect(child.state.count).toBe(5);

    // Ungranted event is rejected at compile time and runtime
    await expect(
      // @ts-expect-error reset was not granted to child
      child.dispatch({ type: "reset" }),
    ).rejects.toThrow(/not permitted/i);
    expect(root.state.count).toBe(5);

    // Recursive narrowing works and prevents re-widening parent permissions
    const grandchild = createScope({
      from: child,
      state: ["count"],
    });
    expect(grandchild.state.count).toBe(5);
    await expect(
      // @ts-expect-error grandchild is read-only
      grandchild.dispatch({ type: "increment", by: 1 }),
    ).rejects.toThrow(/not permitted/i);

    expect(() =>
      // @ts-expect-error secret is not on child
      createScope({
        from: child,
        state: ["secret"],
      }),
    ).toThrow(/not exposed by parent scope/i);

    expect(() =>
      // @ts-expect-error reset is not on child
      createScope({
        from: child,
        events: ["reset"],
      }),
    ).toThrow(/not permitted by parent scope/i);

    grandchild.dispose();
    child.dispose();
    root.dispose();
  });

  test("narrows and widens in one scope with isolated ownership", async () => {
    const root = makeRoot();
    const extended = createScope({
      from: root,
      state: ["count"],
      events: ["increment"],
      initial: () => ({ open: false, note: "" }),
      handlers: {
        setOpen: (s, e: { type: "setOpen"; open: boolean }) => {
          s.open = e.open;
        },
        bumpBoth: async (s, _e: { type: "bumpBoth" }, ctx) => {
          s.note = `was ${ctx.parent.count}`;
          await ctx.dispatchParent({ type: "increment", by: 2 });
          s.open = true;
        },
      },
    });

    expect(Object.keys(extended.state).sort()).toEqual([
      "count",
      "note",
      "open",
    ]);
    expect("secret" in extended.state).toBe(false);

    // Own event
    await extended.dispatch({ type: "setOpen", open: true });
    expect(extended.state.open).toBe(true);

    // Parent event routed upward
    await extended.dispatch({ type: "increment", by: 3 });
    expect(root.state.count).toBe(3);
    expect(extended.state.count).toBe(3);

    // Own handler reading parent snapshot + dispatching granted parent event
    await extended.dispatch({ type: "bumpBoth" });
    expect(extended.state.note).toBe("was 3");
    expect(root.state.count).toBe(5);
    expect(extended.state.count).toBe(5);

    // Disposing stops syncing from parent
    extended.dispose();
    await root.dispatch({ type: "increment", by: 10 });
    expect(root.state.count).toBe(15);
    expect(extended.state.count).toBe(5);

    root.dispose();
  });

  test("allows reusing un-forwarded parent key/event names locally without collision", async () => {
    const root = makeRoot();
    const child = createScope({
      from: root,
      state: ["count"],
      events: ["increment"],
      initial: () => ({ label: "local-label" }),
      handlers: {
        reset: (s) => {
          s.label = "local-reset";
        },
      },
    });

    await child.dispatch({ type: "reset" });
    expect(child.state.label).toBe("local-reset");
    expect(root.state.label).toBe("initial");

    child.dispose();
    root.dispose();
  });

  test("rejects colliding state keys and event names at compile time and runtime", () => {
    const root = makeRoot();

    expect(() =>
      // @ts-expect-error count collides with forwarded parent state key
      createScope({
        from: root,
        state: ["count"],
        initial: () => ({ count: 123 }),
      }),
    ).toThrow(/collides with forwarded parent state key/i);

    expect(() =>
      createScope({
        from: root,
        events: ["increment"],
        initial: () => ({ local: 0 }),
        // @ts-expect-error increment collides with forwarded parent event
        handlers: {
          increment: (s) => {
            s.local += 1;
          },
        },
      }),
    ).toThrow(/collides with forwarded parent event/i);

    root.dispose();
  });
});

function LabelReader({
  scope,
  onRender,
}: {
  scope: StateHandle<{ label: string }, never>;
  onRender: () => void;
}) {
  onRender();
  const { label } = useSnapshot(scope.state);
  return <span data-testid="label">{label}</span>;
}

function CounterPanel({
  scope,
  step,
  onRender,
}: {
  scope: StateHandle<{ count: number }, { type: "increment"; by: number }>;
  step: number;
  onRender: () => void;
}) {
  onRender();
  const panelScope = useScope({
    from: scope,
    state: ["count"],
    events: ["increment"],
    initial: () => ({ clicks: 0 }),
    handlers: {
      click: async (s, _e: { type: "click" }, ctx) => {
        s.clicks += 1;
        // Uses `step` from the latest render closure
        await ctx.dispatchParent({ type: "increment", by: step });
      },
    },
  });

  const snap = useSnapshot(panelScope.state);
  return (
    <div>
      <span data-testid="count">{snap.count}</span>
      <span data-testid="clicks">{snap.clicks}</span>
      <button
        type="button"
        onClick={() => void panelScope.dispatch({ type: "click" })}
      >
        Bump
      </button>
    </div>
  );
}

function Harness({
  root,
  step,
  onLabelRender,
  onCountRender,
}: {
  root: ReturnType<typeof makeRoot>;
  step: number;
  onLabelRender: () => void;
  onCountRender: () => void;
}) {
  const labelScope = useScope({ from: root, state: ["label"] });
  const countScope = useScope({
    from: root,
    state: ["count"],
    events: ["increment"],
  });

  return (
    <>
      <LabelReader scope={labelScope} onRender={onLabelRender} />
      <CounterPanel scope={countScope} step={step} onRender={onCountRender} />
    </>
  );
}

function LocalCounter({ id }: { id: string }) {
  const local = useScope({
    initial: () => ({ value: 0 }),
    handlers: {
      inc: (s) => {
        s.value += 1;
      },
    },
  });
  const { value } = useSnapshot(local.state);
  return (
    <button
      type="button"
      data-testid={id}
      onClick={() => void local.dispatch({ type: "inc" })}
    >
      {value}
    </button>
  );
}

function WriteOnlyButton({
  scope,
}: {
  scope: StateHandle<Record<never, never>, { type: "increment"; by: number }>;
}) {
  return (
    <button
      type="button"
      onClick={() => void scope.dispatch({ type: "increment", by: 10 })}
    >
      Add 10
    </button>
  );
}

function WriteOnlyHarness({ root }: { root: ReturnType<typeof makeRoot> }) {
  const writeScope = useScope({ from: root, events: ["increment"] });
  return <WriteOnlyButton scope={writeScope} />;
}

describe("useScope in React", () => {
  test("isolates re-renders, survives StrictMode, and uses fresh handler closures", async () => {
    const root = makeRoot();
    let labelRenders = 0;
    let countRenders = 0;

    const { rerender } = render(
      <StrictMode>
        <Harness
          root={root}
          step={2}
          onLabelRender={() => {
            labelRenders += 1;
          }}
          onCountRender={() => {
            countRenders += 1;
          }}
        />
      </StrictMode>,
    );

    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("clicks").textContent).toBe("0");
    expect(screen.getByTestId("label").textContent).toBe("initial");

    const labelRendersBefore = labelRenders;
    const countRendersBefore = countRenders;

    // Clicking bumps count by step=2; LabelReader must NOT re-render
    await act(async () => {
      screen.getByRole("button", { name: "Bump" }).click();
    });

    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("clicks").textContent).toBe("1");
    expect(labelRenders).toBe(labelRendersBefore);
    expect(countRenders).toBeGreaterThan(countRendersBefore);

    // Rerender with step=5; fresh handler closure should apply without resetting `clicks`
    rerender(
      <StrictMode>
        <Harness
          root={root}
          step={5}
          onLabelRender={() => {
            labelRenders += 1;
          }}
          onCountRender={() => {
            countRenders += 1;
          }}
        />
      </StrictMode>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Bump" }).click();
    });

    expect(screen.getByTestId("count").textContent).toBe("7");
    expect(screen.getByTestId("clicks").textContent).toBe("2");

    // Mutating label updates LabelReader without re-rendering CounterPanel
    const countRendersAfterClicks = countRenders;
    await act(async () => {
      await root.dispatch({ type: "setLabel", label: "updated" });
    });
    expect(screen.getByTestId("label").textContent).toBe("updated");
    expect(countRenders).toBe(countRendersAfterClicks);

    root.dispose();
  });

  test("keeps multi-instance local useScope stores independent", async () => {
    render(
      <StrictMode>
        <LocalCounter id="first" />
        <LocalCounter id="second" />
      </StrictMode>,
    );

    await act(async () => {
      screen.getByTestId("first").click();
      screen.getByTestId("first").click();
    });

    expect(screen.getByTestId("first").textContent).toBe("2");
    expect(screen.getByTestId("second").textContent).toBe("0");
  });

  test("supports write-only narrowed scopes with omitted state keys", async () => {
    const root = makeRoot();
    render(
      <StrictMode>
        <WriteOnlyHarness root={root} />
      </StrictMode>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Add 10" }).click();
    });

    expect(root.state.count).toBe(10);
    root.dispose();
  });
});
