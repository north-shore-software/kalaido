import { act, render, renderHook, screen } from "@testing-library/react";
import {
  createScope,
  type ScopeHandlers,
  useScope,
  useScopeState,
} from "@kalaido/state/scope";
import type { ReactNode } from "react";
import {
  createScopeContext,
  useOptionalScopeContext,
  useScopeContext,
} from "#create-scope-context";

type AppState = {
  count: number;
  theme: "light" | "dark";
};

type AppEvent =
  | { readonly type: "increment"; readonly by: number }
  | { readonly type: "setTheme"; readonly theme: "light" | "dark" };

const TestScopeContext = createScopeContext<AppState, AppEvent>("TestScope");

function makeTestRoot() {
  const handlers: ScopeHandlers<AppState, AppEvent> = {
    increment: (s, e) => {
      s.count += e.by;
    },
    setTheme: (s, e) => {
      s.theme = e.theme;
    },
  };
  return createScope({
    initial: (): AppState => ({ count: 0, theme: "dark" }),
    handlers,
  });
}

function NarrowCountConsumer() {
  const root = useScopeContext(TestScopeContext);
  const slice = useScope({
    from: root,
    state: ["count"],
    events: ["increment"],
  });
  const { count } = useScopeState(slice);
  return (
    <button
      type="button"
      data-testid="counter"
      onClick={() => void slice.dispatch({ type: "increment", by: 2 })}
    >
      {count}
    </button>
  );
}

describe("createScopeContext", () => {
  test("distributes a StateHandle to descendants that narrow and dispatch through it", async () => {
    const root = makeTestRoot();

    render(
      <TestScopeContext.Provider value={root}>
        <NarrowCountConsumer />
      </TestScopeContext.Provider>,
    );

    expect(screen.getByTestId("counter").textContent).toBe("0");

    await act(async () => {
      screen.getByTestId("counter").click();
    });

    expect(screen.getByTestId("counter").textContent).toBe("2");
    expect(root.state.count).toBe(2);
    expect(root.state.theme).toBe("dark");

    root.dispose();
  });

  test("returns null from useOptionalScopeContext and throws from useScopeContext outside Provider", () => {
    const optional = renderHook(() =>
      useOptionalScopeContext(TestScopeContext),
    );
    expect(optional.result.current).toBeNull();

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useScopeContext(TestScopeContext))).toThrow(
      /TestScope\.Provider/,
    );
    errSpy.mockRestore();
  });

  test("provides the exact handle via useOptionalScopeContext inside Provider", () => {
    const root = makeTestRoot();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestScopeContext.Provider value={root}>
        {children}
      </TestScopeContext.Provider>
    );

    const { result } = renderHook(
      () => useOptionalScopeContext(TestScopeContext),
      { wrapper },
    );
    expect(result.current).toBe(root);

    root.dispose();
  });
});
