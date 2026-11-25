import { act, renderHook, waitFor } from "@testing-library/react";
import { err, ok } from "neverthrow";
import type { ReactNode } from "react";
import { type Cache, SWRConfig } from "swr";
import {
  atomLiveSource,
  clearLiveCache,
  httpLiveSource,
  invalidateLiveTags,
  useExternalWrite,
  useLiveRead,
  type WriteOutcome,
} from "./index";
import { _liveRegistrySize } from "./registry";

function TestSWRProvider({
  cache,
  children,
}: {
  cache: Cache;
  children: ReactNode;
}) {
  return (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

function makeWrapper() {
  const cache: Cache = new Map();
  return ({ children }: { children: ReactNode }) => (
    <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
  );
}

function useTypecheckForbiddenEntityReturn() {
  type LeakyEntity = {
    readonly id: string;
    readonly status: "queued";
    readonly title: string;
  };
  return useExternalWrite<void, LeakyEntity>({
    // @ts-expect-error full entity records with extra keys are forbidden
    execute: async () => ok({ id: "1", status: "queued", title: "Forbidden" }),
  });
}
void useTypecheckForbiddenEntityReturn;

describe("useLiveRead + atomLiveSource", () => {
  test("renders synchronously on initial mount, pushes atom updates via setData, and cleans up on unmount", async () => {
    let current = { signedIn: false, email: null as string | null };
    const listeners = new Set<(v: typeof current) => void>();
    const refetch = vi.fn(async () =>
      ok({ signedIn: true, email: "refetched@b.co" }),
    );

    const { result, unmount } = renderHook(
      () =>
        useLiveRead(
          atomLiveSource({
            key: ["auth", "session"],
            tags: ["auth:session"],
            read: () => current,
            subscribe: (fn) => {
              listeners.add(fn);
              return () => listeners.delete(fn);
            },
            refetch,
          }),
        ),
      { wrapper: makeWrapper() },
    );

    // Synchronous initial snapshot — no undefined loading flash and no mount refetch
    expect(result.current.data).toEqual({ signedIn: false, email: null });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe("ready");
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      current = { signedIn: true, email: "a@b.co" };
      for (const fn of listeners) fn(current);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        signedIn: true,
        email: "a@b.co",
      });
    });

    // Explicit tag invalidation invokes `refetch`
    await act(async () => {
      await invalidateLiveTags(["auth:session"]);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({
      signedIn: true,
      email: "refetched@b.co",
    });

    await act(async () => {
      await clearLiveCache((k) => k[0] === "auth");
    });
    expect(result.current.data).toBeUndefined();

    unmount();
    expect(listeners.size).toBe(0);
    expect(_liveRegistrySize()).toEqual({ keys: 0, tags: 0 });
  });
});

describe("useLiveRead + httpLiveSource", () => {
  test("disabled source (key: null) does not fetch", () => {
    const fetchFn = vi.fn(async () => ok(["x"]));
    const { result } = renderHook(
      () => useLiveRead(httpLiveSource({ key: null, fetch: fetchFn })),
      { wrapper: makeWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe("ready");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("seeds cached value when offline fetch fails, and reconciles + writes when online", async () => {
    type Workspace = { id: string; name: string; icon?: string };
    let stored: Workspace[] | undefined = [
      { id: "w1", name: "Cached", icon: "star" },
    ];
    let online = false;

    const write = vi.fn(async (next: Workspace[]) => {
      stored = next;
    });

    const { result } = renderHook(
      () =>
        useLiveRead(
          httpLiveSource<Workspace[]>({
            key: ["cloud", "workspaces"],
            tags: ["cloud:workspaces"],
            fetch: async () => {
              if (!online) return err(new Error("offline"));
              return ok([{ id: "w1", name: "Fresh" }]);
            },
            offlineCache: {
              read: async () => stored,
              reconcile: (cached, fresh) =>
                fresh.map((f) => ({
                  ...f,
                  icon: cached?.find((c) => c.id === f.id)?.icon,
                })),
              write,
            },
          }),
        ),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: "w1", name: "Cached", icon: "star" },
      ]);
      expect(result.current.error?.message).toBe("offline");
      expect(result.current.status).toBe("ready");
    });
    expect(write).not.toHaveBeenCalled();

    online = true;
    await act(async () => {
      await invalidateLiveTags(["cloud:workspaces"]);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: "w1", name: "Fresh", icon: "star" },
      ]);
      expect(result.current.error).toBeNull();
    });
    expect(write).toHaveBeenCalledWith([
      { id: "w1", name: "Fresh", icon: "star" },
    ]);
  });

  test("online boot with fast offlineCache.read does not discard slower fresh server fetch", async () => {
    type Workspace = { id: string; name: string; icon?: string };
    const wrapper = makeWrapper();

    const { result, unmount } = renderHook(
      () =>
        useLiveRead(
          httpLiveSource<Workspace[]>({
            key: ["cloud", "online-boot"],
            fetch: async () => {
              await new Promise((r) => setTimeout(r, 40));
              return ok([{ id: "w1", name: "FreshServer" }]);
            },
            offlineCache: {
              read: async () => {
                await new Promise((r) => setTimeout(r, 5));
                return [{ id: "w1", name: "StaleDisk", icon: "pin" }];
              },
              reconcile: (cached, fresh) =>
                fresh.map((f) => ({
                  ...f,
                  icon: cached?.find((c) => c.id === f.id)?.icon,
                })),
              write: async () => {},
            },
          }),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: "w1", name: "FreshServer", icon: "pin" },
      ]);
      expect(result.current.isValidating).toBe(false);
    });

    unmount();
  });

  test("clearLiveCache evicts unmounted keys from isolated SWRConfig caches", async () => {
    const cache: Cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
    );

    const mounted = renderHook(
      () =>
        useLiveRead(
          httpLiveSource({
            key: ["secret", "profile"],
            fetch: async () => ok("sensitive"),
          }),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(mounted.result.current.data).toBe("sensitive");
    });

    mounted.unmount();
    expect(Array.from(cache.keys()).length).toBeGreaterThan(0);

    await clearLiveCache((k) => k[0] === "secret");
    expect(Array.from(cache.keys())).toEqual([]);
  });
});

describe("useExternalWrite", () => {
  test("creates return { status: 'success', id } and invalidate paired live reads before resolving", async () => {
    const items = ["b1"];

    const { result } = renderHook(
      () => {
        const read = useLiveRead(
          httpLiveSource({
            key: ["api", "backups"],
            tags: ["api:backups"],
            fetch: async () => ok([...items]),
          }),
        );
        const createItem = useExternalWrite<string, { readonly id: string }>({
          execute: async (id) => {
            items.push(id);
            return ok({ id });
          },
          invalidates: ["api:backups"],
        });
        return { read, createItem };
      },
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.read.data).toEqual(["b1"]);
    });

    let outcome: WriteOutcome<{ readonly id: string }> | undefined;
    await act(async () => {
      outcome = await result.current.createItem.run("b2");
    });

    expect(outcome).toEqual({ status: "success", id: "b2" });
    expect(result.current.createItem.status).toBe("success");
    expect(result.current.createItem.isPending).toBe(false);
    expect(result.current.read.data).toEqual(["b1", "b2"]);
  });

  test("default concurrency ('ignore') drops overlapping calls and returns { status: 'ignored' }", async () => {
    let resolveFirst!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<ReturnType<typeof ok<void>>>((resolve) => {
          resolveFirst = () => resolve(ok(undefined));
        }),
    );

    const { result } = renderHook(() => useExternalWrite({ execute }));

    let p1!: Promise<WriteOutcome<void>>;
    let secondOutcome: WriteOutcome<void> | undefined;

    await act(async () => {
      p1 = result.current.run();
      secondOutcome = await result.current.run();
    });

    expect(secondOutcome).toEqual({ status: "ignored" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(true);

    let firstOutcome: WriteOutcome<void> | undefined;
    await act(async () => {
      resolveFirst();
      firstOutcome = await p1;
    });

    expect(firstOutcome).toEqual({ status: "success" });
    expect(result.current.status).toBe("success");
  });

  test("concurrency ('allow') permits overlapping writes and stays pending until all finish", async () => {
    const resolvers: (() => void)[] = [];
    const execute = vi.fn(
      () =>
        new Promise<ReturnType<typeof ok<void>>>((resolve) => {
          resolvers.push(() => resolve(ok(undefined)));
        }),
    );

    const { result } = renderHook(() =>
      useExternalWrite<string>({ execute, concurrency: "allow" }),
    );

    let p1!: Promise<WriteOutcome<void>>;
    let p2!: Promise<WriteOutcome<void>>;

    act(() => {
      p1 = result.current.run("a");
      p2 = result.current.run("b");
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolvers[0]();
      expect(await p1).toEqual({ status: "success" });
    });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolvers[1]();
      expect(await p2).toEqual({ status: "success" });
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.status).toBe("success");
  });

  test("returns { status: 'error', error } without throwing on Result err or unexpected throw", async () => {
    const { result: errHook } = renderHook(() =>
      useExternalWrite({
        execute: async () => err(new Error("boom")),
      }),
    );

    let outcome: WriteOutcome<void> | undefined;
    await act(async () => {
      outcome = await errHook.current.run();
    });

    expect(outcome?.status).toBe("error");
    if (outcome?.status === "error") {
      expect(outcome.error.message).toBe("boom");
    }
    expect(errHook.current.status).toBe("error");
    expect(errHook.current.error?.message).toBe("boom");

    act(() => errHook.current.reset());
    expect(errHook.current.status).toBe("idle");
    expect(errHook.current.error).toBeNull();

    const { result: throwHook } = renderHook(() =>
      useExternalWrite({
        execute: async () => {
          throw new Error("unexpected");
        },
      }),
    );

    let thrownOutcome: WriteOutcome<void> | undefined;
    await act(async () => {
      thrownOutcome = await throwHook.current.run();
    });
    expect(thrownOutcome?.status).toBe("error");
    expect(throwHook.current.error?.message).toBe("unexpected");
  });

  test("rejects full entity records at compile time, strips extra fields at runtime, clears stale concurrent errors, and ignores mid-flight reset()", async () => {
    // Runtime defense: even if cast past TypeScript, extra keys and `status` cannot leak or clobber
    const untypedEntity = {
      id: "rec_1",
      status: "queued",
      title: "Secret",
    } as unknown as { readonly id: string };

    const { result: stripHook } = renderHook(() =>
      useExternalWrite<void, { readonly id: string }>({
        execute: async () => ok(untypedEntity),
      }),
    );

    let stripped: WriteOutcome<{ readonly id: string }> | undefined;
    await act(async () => {
      stripped = await stripHook.current.run();
    });
    expect(stripped).toEqual({ status: "success", id: "rec_1" });
    expect("title" in (stripped ?? {})).toBe(false);

    // Concurrency "allow": later success clears earlier error; mid-flight reset() is ignored
    const resolvers: ((okVal: boolean) => void)[] = [];
    const { result: concHook } = renderHook(() =>
      useExternalWrite<void>({
        concurrency: "allow",
        execute: () =>
          new Promise((resolve) => {
            resolvers.push((succeed) =>
              resolve(succeed ? ok(undefined) : err(new Error("first failed"))),
            );
          }),
      }),
    );

    let p1!: Promise<WriteOutcome<void>>;
    let p2!: Promise<WriteOutcome<void>>;
    act(() => {
      p1 = concHook.current.run();
      p2 = concHook.current.run();
    });

    // Mid-flight reset() is a no-op while pending
    act(() => {
      concHook.current.reset();
    });
    expect(concHook.current.status).toBe("pending");
    expect(concHook.current.isPending).toBe(true);

    // First settles with error, second settles with success -> status="success", error=null
    await act(async () => {
      resolvers[0]?.(false);
      await p1;
    });
    expect(concHook.current.status).toBe("pending");
    expect(concHook.current.error?.message).toBe("first failed");

    await act(async () => {
      resolvers[1]?.(true);
      await p2;
    });
    expect(concHook.current.status).toBe("success");
    expect(concHook.current.error).toBeNull();
  });
});
