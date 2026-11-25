import { act, render, renderHook, screen } from "@testing-library/react";
import { StrictMode, useEffect, useLayoutEffect } from "react";
import { ref, snapshot } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  createScope,
  type ScopeHandlers,
  type StateHandle,
  useScope,
  useScopeState,
} from "./use-scope";

type RootState = {
  count: number;
  label: string;
  secret: string;
  items: { id: number; name: string }[];
  panel: { tab: string; draft: string };
  optionalNote?: string;
};

type RootEvent =
  | { type: "increment"; by: number }
  | { type: "setLabel"; label: string }
  | { type: "addItem"; name: string }
  | { type: "setTab"; tab: string }
  | { type: "setDraft"; draft: string }
  | { type: "setNote"; note?: string }
  | { type: "asyncIncrement"; by: number }
  | { type: "failAfterBump" }
  | { type: "reset" };

function makeRoot(initialCount = 0) {
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
    setTab: (s, e) => {
      s.panel.tab = e.tab;
    },
    setDraft: (s, e) => {
      s.panel.draft = e.draft;
    },
    setNote: (s, e) => {
      if (e.note === undefined) {
        delete s.optionalNote;
      } else {
        s.optionalNote = e.note;
      }
    },
    asyncIncrement: async (s, e) => {
      await Promise.resolve();
      s.count += e.by;
    },
    failAfterBump: async (s) => {
      s.count += 1;
      await Promise.resolve();
      throw new Error("handler boom");
    },
    reset: (s) => {
      s.count = 0;
      s.label = "initial";
      s.items = [];
    },
  };

  return createScope({
    initial: (): RootState => ({
      count: initialCount,
      label: "initial",
      secret: "top-secret",
      items: [{ id: 1, name: "first" }],
      panel: { tab: "chat", draft: "" },
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
      panel: { tab: "chat", draft: "" },
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

  test("rejects direct runtime mutation of exposed state (top-level, symbol, delete, and nested)", async () => {
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

    const sym = Symbol("injectedSym");
    expect(() => {
      (root.state as Record<PropertyKey, unknown>)[sym] = "leak";
    }).toThrow(TypeError);
    expect(sym in root.state).toBe(false);
    expect(Reflect.ownKeys(root.state)).not.toContain(sym);

    expect(() => {
      delete (root.state as Record<string, unknown>).count;
    }).toThrow(TypeError);
    expect(root.state.count).toBe(0);

    expect(() => {
      // @ts-expect-error nested arrays are deeply frozen
      root.state.items.push({ id: 99, name: "bad" });
    }).toThrow(TypeError);
    expect(root.state.items).toHaveLength(1);

    expect(() => {
      // @ts-expect-error nested objects are deeply frozen
      root.state.items[0].name = "mutated";
    }).toThrow(TypeError);
    expect(root.state.items[0].name).toBe("first");

    // Owner handlers still work after rejected writes
    await root.dispatch({ type: "increment", by: 1 });
    expect(root.state.count).toBe(1);

    root.dispose();
  });

  test("supports optional keys omitted from initial() and deleted later", async () => {
    const root = makeRoot();
    const child = createScope({
      from: root,
      state: ["optionalNote", "count"],
    });

    expect("optionalNote" in root.state).toBe(false);
    expect("optionalNote" in child.state).toBe(false);

    await root.dispatch({ type: "setNote", note: "hello" });
    expect(root.state.optionalNote).toBe("hello");
    expect(child.state.optionalNote).toBe("hello");

    await root.dispatch({ type: "setNote", note: undefined });
    expect("optionalNote" in root.state).toBe(false);
    expect("optionalNote" in child.state).toBe(false);

    child.dispose();
    root.dispose();
  });

  test("preserves non-plain objects (Uint8Array, ref instances) without freezing them", async () => {
    const controller = new AbortController();
    const binaryScope = createScope({
      initial: () => ({
        bytes: new Uint8Array([1, 2, 3]),
        controller: ref(controller),
      }),
      handlers: {
        replaceBytes: (s, e: { type: "replaceBytes"; bytes: Uint8Array }) => {
          s.bytes = e.bytes;
        },
      },
    });

    expect(binaryScope.state.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(binaryScope.state.bytes)).toEqual([1, 2, 3]);
    expect(binaryScope.state.controller).toBe(controller);
    expect(Object.isFrozen(controller)).toBe(false);

    await binaryScope.dispatch({
      type: "replaceBytes",
      bytes: new Uint8Array([4, 5]),
    });
    expect(Array.from(binaryScope.state.bytes)).toEqual([4, 5]);

    binaryScope.dispose();
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

  test("narrows and widens in one scope with unannotated payload-less handlers and isolated ownership", async () => {
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
        // `_e` intentionally unannotated to verify `{ readonly type: "bumpBoth" }` inference
        bumpBoth: async (s, _e, ctx) => {
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

    // Disposing is idempotent, stops syncing from parent, and rejects further dispatches
    extended.dispose();
    extended.dispose();
    await root.dispatch({ type: "increment", by: 10 });
    expect(root.state.count).toBe(15);
    expect(extended.state.count).toBe(5);

    await expect(
      extended.dispatch({ type: "increment", by: 1 }),
    ).rejects.toThrow(/disposed/i);
    await expect(
      extended.dispatch({ type: "setOpen", open: false }),
    ).rejects.toThrow(/disposed/i);
    expect(root.state.count).toBe(15);
    expect(extended.state.open).toBe(true);

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
        reset: (s, _e) => {
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

  test("rejects colliding state keys, colliding event names, and mismatched handler tags", async () => {
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

    createScope({
      initial: () => ({ count: 0 }),
      // @ts-expect-error event tag does not match handler key
      handlers: {
        inc: (s, e: { type: "wrong"; by: number }) => {
          s.count += e.by;
        },
      },
    }).dispose();

    // Dynamic runtime collision inside a handler is also rejected
    const extended = createScope({
      from: root,
      state: ["count"],
      initial: () => ({ local: 0 }),
      handlers: {
        sneakyCollide: (s) => {
          (s as Record<string, unknown>).count = 999;
        },
      },
    });

    await expect(extended.dispatch({ type: "sneakyCollide" })).rejects.toThrow(
      /collides with forwarded parent state key/i,
    );
    expect(extended.state.count).toBe(0);

    extended.dispose();
    root.dispose();
  });

  test("recovers cleanly after a handler throws", async () => {
    const root = makeRoot();

    await expect(root.dispatch({ type: "failAfterBump" })).rejects.toThrow(
      "handler boom",
    );
    // Mutation before the async failure is synced consistently
    expect(root.state.count).toBe(1);

    // Subsequent dispatches still succeed
    await root.dispatch({ type: "increment", by: 4 });
    expect(root.state.count).toBe(5);

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
  useEffect(() => {
    onRender();
  });
  const { label } = useScopeState(scope);
  return <span data-testid="label">{label}</span>;
}

function PanelTabReader({
  scope,
  onRender,
}: {
  scope: StateHandle<{ panel: { tab: string; draft: string } }, never>;
  onRender: () => void;
}) {
  useEffect(() => {
    onRender();
  });
  const { panel } = useScopeState(scope);
  return <span data-testid="tab">{panel.tab}</span>;
}

function PanelHarness({
  root,
  onTabRender,
}: {
  root: ReturnType<typeof makeRoot>;
  onTabRender: () => void;
}) {
  const panelScope = useScope({ from: root, state: ["panel"] });
  return <PanelTabReader scope={panelScope} onRender={onTabRender} />;
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
  useEffect(() => {
    onRender();
  });
  const panelScope = useScope({
    from: scope,
    state: ["count"],
    events: ["increment"],
    initial: () => ({ clicks: 0 }),
    handlers: {
      click: async (s, _e, ctx) => {
        s.clicks += 1;
        // Uses `step` from the latest committed render closure
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
  const { value } = useScopeState(local);
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

function LayoutEffectChild({
  scope,
  observedAfterDispatch,
}: {
  scope: StateHandle<{ count: number }, { type: "increment"; by: number }>;
  observedAfterDispatch: number[];
}) {
  const leaf = useScope({
    from: scope,
    state: ["count"],
    events: ["increment"],
    initial: () => ({ ready: false }),
    handlers: {
      init: async (s, _e, ctx) => {
        await ctx.dispatchParent({ type: "increment", by: 3 });
        observedAfterDispatch.push(ctx.parent.count);
        s.ready = true;
      },
    },
  });

  useLayoutEffect(() => {
    void leaf.dispatch({ type: "init" });
  }, [leaf]);

  const snap = useScopeState(leaf);
  return (
    <span data-testid="leaf-count">
      {snap.count}:{String(snap.ready)}
    </span>
  );
}

function LayoutEffectParent({
  root,
  observedAfterDispatch,
}: {
  root: ReturnType<typeof makeRoot>;
  observedAfterDispatch: number[];
}) {
  const mid = useScope({
    from: root,
    state: ["count"],
    events: ["increment"],
  });
  return (
    <LayoutEffectChild
      scope={mid}
      observedAfterDispatch={observedAfterDispatch}
    />
  );
}

function SwitchableWorkspaceView({
  root,
  reverseKeys,
}: {
  root: ReturnType<typeof makeRoot>;
  reverseKeys: boolean;
}) {
  const view = useScope({
    from: root,
    state: reverseKeys ? ["label", "count"] : ["count", "label"],
    events: ["increment"],
    initial: () => ({ localDraft: "clean" }),
    handlers: {
      editDraft: (s, e: { type: "editDraft"; text: string }) => {
        s.localDraft = e.text;
      },
    },
  });

  const snap = useScopeState(view);
  return (
    <div>
      <span data-testid="ws-count">{snap.count}</span>
      <span data-testid="ws-draft">{snap.localDraft}</span>
      <button
        type="button"
        onClick={() => void view.dispatch({ type: "editDraft", text: "dirty" })}
      >
        Dirty
      </button>
    </div>
  );
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

  test("preserves nested path-level render isolation in useScopeState", async () => {
    const root = makeRoot();
    let tabRenders = 0;

    render(
      <StrictMode>
        <PanelHarness
          root={root}
          onTabRender={() => {
            tabRenders += 1;
          }}
        />
      </StrictMode>,
    );

    expect(screen.getByTestId("tab").textContent).toBe("chat");
    const rendersBeforeDraft = tabRenders;

    // Updating sibling `panel.draft` must NOT re-render a component reading only `panel.tab`
    await act(async () => {
      await root.dispatch({ type: "setDraft", draft: "typing..." });
    });
    expect(tabRenders).toBe(rendersBeforeDraft);

    // Updating `panel.tab` DOES re-render
    await act(async () => {
      await root.dispatch({ type: "setTab", tab: "sources" });
    });
    expect(screen.getByTestId("tab").textContent).toBe("sources");
    expect(tabRenders).toBeGreaterThan(rendersBeforeDraft);

    root.dispose();
  });

  test("syncs intermediate useScope state when a child useLayoutEffect dispatches before parent attach", async () => {
    const root = makeRoot();
    const observed: number[] = [];

    await act(async () => {
      render(
        <LayoutEffectParent root={root} observedAfterDispatch={observed} />,
      );
    });

    expect(observed).toEqual([3]);
    expect(root.state.count).toBe(3);
    expect(screen.getByTestId("leaf-count").textContent).toBe("3:true");

    root.dispose();
  });

  test("survives StrictMode remount when a child useLayoutEffect dispatches on a parent useScope", async () => {
    const root = makeRoot();
    const observed: number[] = [];

    await act(async () => {
      render(
        <StrictMode>
          <LayoutEffectParent root={root} observedAfterDispatch={observed} />
        </StrictMode>,
      );
    });

    expect(root.state.count).toBe(6);
    expect(screen.getByTestId("leaf-count").textContent).toBe("6:true");
    expect(observed).toHaveLength(2);

    root.dispose();
  });

  test("keeps local state on key-order permutations and resets local state when `from` switches", async () => {
    const workspaceA = makeRoot(10);
    const workspaceB = makeRoot(42);

    const { rerender } = render(
      <StrictMode>
        <SwitchableWorkspaceView root={workspaceA} reverseKeys={false} />
      </StrictMode>,
    );

    expect(screen.getByTestId("ws-count").textContent).toBe("10");
    expect(screen.getByTestId("ws-draft").textContent).toBe("clean");

    await act(async () => {
      screen.getByRole("button", { name: "Dirty" }).click();
    });
    expect(screen.getByTestId("ws-draft").textContent).toBe("dirty");

    // Reordering `state` keys must NOT reset `localDraft`
    rerender(
      <StrictMode>
        <SwitchableWorkspaceView root={workspaceA} reverseKeys={true} />
      </StrictMode>,
    );
    expect(screen.getByTestId("ws-draft").textContent).toBe("dirty");

    // Switching `from` to workspaceB resets `localDraft` and reads workspaceB's count
    rerender(
      <StrictMode>
        <SwitchableWorkspaceView root={workspaceB} reverseKeys={true} />
      </StrictMode>,
    );
    expect(screen.getByTestId("ws-count").textContent).toBe("42");
    expect(screen.getByTestId("ws-draft").textContent).toBe("clean");

    workspaceA.dispose();
    workspaceB.dispose();
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

  test("deactivates useScope handles on unmount and when `from` switches, stopping post-unmount dispatches and persistence", async () => {
    const saves: [string, unknown][] = [];
    const rootA = makeRoot(1);
    const rootB = makeRoot(2);

    const { result, rerender, unmount } = renderHook(
      ({ parent }) =>
        useScope({
          from: parent,
          state: ["count"] as const,
          initial: () => ({ theme: "light" }),
          handlers: {
            setTheme: (s, e: { type: "setTheme"; theme: string }) => {
              s.theme = e.theme;
            },
          },
          persist: {
            keys: ["theme"] as const,
            adapter: {
              load: async () =>
                ({ isOk: () => true, isErr: () => false, value: {} }) as never,
              save: async (k, v) => {
                saves.push([k, v]);
                return {
                  isOk: () => true,
                  isErr: () => false,
                  value: undefined,
                } as never;
              },
              remove: async () =>
                ({
                  isOk: () => true,
                  isErr: () => false,
                  value: undefined,
                }) as never,
            },
          },
        }),
      {
        initialProps: { parent: rootA },
        wrapper: StrictMode,
      },
    );

    const handleA = result.current;

    // Switching `from` permanently disposes the replaced child scope
    rerender({ parent: rootB });

    const handleB = result.current;
    expect(handleB).not.toBe(handleA);
    await expect(
      handleA.dispatch({ type: "setTheme", theme: "stale" }),
    ).rejects.toThrow(/disposed/i);

    // Unmounting synchronously deactivates the active scope handle
    unmount();
    await expect(
      handleB.dispatch({ type: "setTheme", theme: "after-unmount" }),
    ).rejects.toThrow(/disposed/i);
    expect(saves).toEqual([]);

    rootA.dispose();
    rootB.dispose();
  });

  test("batches consecutive post-await mutations in async handlers and catches post-await parent key collisions", async () => {
    const savedConfigs: { host: string; port: number }[] = [];
    const scope = createScope({
      initial: () => ({ config: { host: "localhost", port: 3000 } }),
      handlers: {
        updateBothAsync: async (
          s,
          e: { type: "updateBothAsync"; host: string; port: number },
        ) => {
          await Promise.resolve();
          s.config.host = e.host;
          s.config.port = e.port;
        },
      },
      persist: {
        keys: ["config"] as const,
        adapter: {
          load: async () =>
            ({ isOk: () => true, isErr: () => false, value: {} }) as never,
          save: async (_k, v) => {
            savedConfigs.push(v);
            return {
              isOk: () => true,
              isErr: () => false,
              value: undefined,
            } as never;
          },
          remove: async () =>
            ({
              isOk: () => true,
              isErr: () => false,
              value: undefined,
            }) as never,
        },
      },
    });

    await scope.hydrate();
    await scope.dispatch({
      type: "updateBothAsync",
      host: "prod.local",
      port: 8080,
    });
    await scope.flush();

    // Persisted once with the complete post-await object, never a torn intermediate
    expect(savedConfigs).toEqual([{ host: "prod.local", port: 8080 }]);
    expect(scope.state.config).toEqual({ host: "prod.local", port: 8080 });
    scope.dispose();

    // Post-await dynamic parent-key collision rejects dispatch() cleanly
    const root = makeRoot();
    const child = createScope({
      from: root,
      state: ["count"],
      initial: () => ({ local: 0 }),
      handlers: {
        asyncCollide: async (s) => {
          await Promise.resolve();
          (s as Record<string, unknown>).count = 999;
        },
      },
    });
    await expect(child.dispatch({ type: "asyncCollide" })).rejects.toThrow(
      /collides with forwarded parent state key/i,
    );
    child.dispose();
    root.dispose();
  });
});
