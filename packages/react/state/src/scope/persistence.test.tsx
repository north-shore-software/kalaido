import { act, renderHook } from "@testing-library/react";
import { err, ok, type Result } from "neverthrow";
import type { ScopePersistenceAdapter } from "./persistence";
import { createScope, useScope } from "./use-scope";

interface MemoryAdapterHarness<T extends Record<string, unknown>> {
  adapter: ScopePersistenceAdapter<T>;
  store: Partial<T>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function createMemoryAdapter<T extends Record<string, unknown>>(
  seed: Partial<T> = {},
): MemoryAdapterHarness<T> {
  const store: Partial<T> = { ...seed };
  const load = vi.fn(
    async (): Promise<Result<Partial<T>, Error>> => ok({ ...store }),
  );
  const save = vi.fn(
    async <K extends keyof T & string>(
      key: K,
      value: T[K],
    ): Promise<Result<void, Error>> => {
      store[key] = value;
      return ok(undefined);
    },
  );
  const remove = vi.fn(
    async <K extends keyof T & string>(
      key: K,
    ): Promise<Result<void, Error>> => {
      delete store[key];
      return ok(undefined);
    },
  );
  return {
    adapter: { load, save, remove },
    store,
    load,
    save,
    remove,
  };
}

describe("persisted createScope & useScope", () => {
  test("explicit hydrate loads persisted keys, runs onHydrated, and does not echo writes back to disk", async () => {
    type State = {
      stage: "bootstrap" | "ready" | "error";
      theme: "light" | "dark" | "system";
      model: string;
      lastId?: string;
    };

    const mem = createMemoryAdapter<Pick<State, "theme" | "model" | "lastId">>({
      theme: "dark",
      model: "llama3",
    });

    const scope = createScope({
      initial: (): State => ({
        stage: "bootstrap",
        theme: "system",
        model: "default",
      }),
      handlers: {
        setTheme: (s, e: { type: "setTheme"; theme: State["theme"] }) => {
          s.theme = e.theme;
        },
        setLastId: (s, e: { type: "setLastId"; id?: string }) => {
          s.lastId = e.id;
        },
      },
      persist: {
        keys: ["theme", "model", "lastId"] as const,
        adapter: mem.adapter,
        onHydrated: (s, res) => {
          s.stage = res.isOk() ? "ready" : "error";
        },
      },
    });

    expect(scope.getHydrationStatus()).toBe("pending");
    expect(scope.state.stage).toBe("bootstrap");
    expect(scope.state.theme).toBe("system");
    expect(mem.load).not.toHaveBeenCalled();
    expect(mem.save).not.toHaveBeenCalled();

    const hydrated = await scope.hydrate();
    expect(hydrated.isOk()).toBe(true);
    expect(scope.getHydrationStatus()).toBe("ready");
    expect(scope.state.stage).toBe("ready");
    expect(scope.state.theme).toBe("dark");
    expect(scope.state.model).toBe("llama3");
    expect(mem.save).not.toHaveBeenCalled();
    expect(mem.remove).not.toHaveBeenCalled();

    await scope.dispatch({ type: "setTheme", theme: "light" });
    expect(scope.state.theme).toBe("light");
    await scope.flush();
    expect(mem.save).toHaveBeenCalledTimes(1);
    expect(mem.save).toHaveBeenCalledWith("theme", "light");
    expect(mem.store.theme).toBe("light");

    await scope.dispatch({ type: "setLastId", id: "ws-1" });
    await scope.flush();
    expect(mem.store.lastId).toBe("ws-1");

    await scope.dispatch({ type: "setLastId", id: undefined });
    await scope.flush();
    expect(mem.remove).toHaveBeenCalledWith("lastId");
    expect("lastId" in mem.store).toBe(false);

    scope.dispose();
  });

  test("preserves keys mutated before hydration finishes (dirty-key protection)", async () => {
    type State = { theme: string; model: string };
    let resolveLoad!: (res: Result<Partial<State>, Error>) => void;

    const mem = createMemoryAdapter<State>();
    mem.load.mockImplementation(
      () =>
        new Promise<Result<Partial<State>, Error>>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const scope = createScope({
      initial: (): State => ({ theme: "system", model: "default" }),
      handlers: {
        setTheme: (s, e: { type: "setTheme"; theme: string }) => {
          s.theme = e.theme;
        },
      },
      persist: {
        keys: ["theme", "model"] as const,
        adapter: mem.adapter,
      },
    });

    const hydratePromise = scope.hydrate();
    await scope.dispatch({ type: "setTheme", theme: "dark" });

    resolveLoad(ok({ theme: "light", model: "saved" }));
    await hydratePromise;
    await scope.flush();

    expect(scope.state.theme).toBe("dark");
    expect(scope.state.model).toBe("saved");
    expect(mem.save).toHaveBeenCalledTimes(1);
    expect(mem.save).toHaveBeenCalledWith("theme", "dark");

    scope.dispose();
  });

  test("serializes and coalesces rapid writes per key so latest value always wins", async () => {
    type State = { model: string };
    const written: string[] = [];
    let releaseFirst!: () => void;

    const mem = createMemoryAdapter<State>();
    mem.save.mockImplementation(async (_key: string, value: string) => {
      if (written.length === 0) {
        await new Promise<void>((r) => {
          releaseFirst = r;
        });
      }
      written.push(value);
      return ok(undefined);
    });

    const scope = createScope({
      initial: (): State => ({ model: "m0" }),
      handlers: {
        setModel: (s, e: { type: "setModel"; model: string }) => {
          s.model = e.model;
        },
      },
      persist: {
        keys: ["model"] as const,
        adapter: mem.adapter,
      },
    });

    await scope.hydrate();

    await scope.dispatch({ type: "setModel", model: "m1" });
    await scope.dispatch({ type: "setModel", model: "m2" });
    await scope.dispatch({ type: "setModel", model: "m3" });

    releaseFirst();
    await scope.flush();

    expect(written).toEqual(["m1", "m3"]);
    expect(scope.state.model).toBe("m3");

    await scope.dispatch({ type: "setModel", model: "m4" });
    scope.dispose();
    await scope.flush();
    expect(written).toEqual(["m1", "m3", "m4"]);
  });

  test("write errors are non-fatal, never roll back memory, and report to onWriteError", async () => {
    type State = { theme: string };
    const onWriteError = vi.fn();
    const mem = createMemoryAdapter<State>();
    mem.save.mockResolvedValue(err(new Error("disk full")));

    const scope = createScope({
      initial: (): State => ({ theme: "light" }),
      handlers: {
        setTheme: (s, e: { type: "setTheme"; theme: string }) => {
          s.theme = e.theme;
        },
      },
      persist: {
        keys: ["theme"] as const,
        adapter: mem.adapter,
        onWriteError,
      },
    });

    await scope.hydrate();
    await scope.dispatch({ type: "setTheme", theme: "dark" });
    await scope.flush();

    expect(scope.state.theme).toBe("dark");
    expect(onWriteError).toHaveBeenCalledTimes(1);
    const [errKey, errVal] = onWriteError.mock.calls[0] ?? [];
    expect(errKey).toBe("theme");
    expect((errVal as Error | undefined)?.message).toBe("disk full");

    scope.dispose();
  });

  test("hydration failure sets error status, invokes onHydrated with err, and allows retry", async () => {
    type State = { stage: string; theme: string };
    const mem = createMemoryAdapter<Pick<State, "theme">>();
    mem.load.mockResolvedValueOnce(err(new Error("corrupt file")));

    const scope = createScope({
      initial: (): State => ({ stage: "bootstrap", theme: "system" }),
      handlers: {},
      persist: {
        keys: ["theme"] as const,
        adapter: mem.adapter,
        onHydrated: (s, res) => {
          s.stage = res.isErr() ? `error:${res.error.message}` : "ready";
        },
      },
    });

    const first = await scope.hydrate();
    expect(first.isErr()).toBe(true);
    expect(scope.getHydrationStatus()).toBe("error");
    expect(scope.state.stage).toBe("error:corrupt file");

    mem.load.mockResolvedValueOnce(ok({ theme: "dark" }));
    const second = await scope.hydrate();
    expect(second.isOk()).toBe(true);
    expect(scope.getHydrationStatus()).toBe("ready");
    expect(scope.state.stage).toBe("ready");
    expect(scope.state.theme).toBe("dark");

    scope.dispose();
  });

  test("supports persisted extended scopes and persisted useScope inside React", async () => {
    const parent = createScope({
      initial: () => ({ appVersion: "1.0" }),
      handlers: {},
    });

    const mem = createMemoryAdapter<{ sidebarOpen: boolean }>({
      sidebarOpen: false,
    });

    const { result } = renderHook(() =>
      useScope({
        from: parent,
        state: ["appVersion"] as const,
        initial: () => ({ sidebarOpen: true }),
        handlers: {
          toggle: (s) => {
            s.sidebarOpen = !s.sidebarOpen;
          },
        },
        persist: {
          keys: ["sidebarOpen"] as const,
          adapter: mem.adapter,
        },
      }),
    );

    expect(result.current.state.appVersion).toBe("1.0");
    expect(result.current.state.sidebarOpen).toBe(true);

    await act(async () => {
      await result.current.hydrate();
    });
    expect(result.current.state.sidebarOpen).toBe(false);

    await act(async () => {
      await result.current.dispatch({ type: "toggle" });
      await result.current.flush();
    });
    expect(result.current.state.sidebarOpen).toBe(true);
    expect(mem.store.sidebarOpen).toBe(true);

    parent.dispose();
  });
});
