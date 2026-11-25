import type { TypedPocketBase } from "@kalaido/client/kalaidoscope/types";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { err, ok, type Result } from "neverthrow";
import type { ReactNode } from "react";
import { type Cache, SWRConfig } from "swr";
import {
  atomLiveSource,
  clearCloudLiveCache,
  clearWorkspaceLiveCache,
  disposeClientSubscriptions,
  httpLiveSource,
  invalidateLiveTags,
  pbCollectionSource,
  pbEndpointSource,
  useExternalWrite,
  useLiveRead,
  type WriteOutcome,
} from "./index";
import { _pbHubChannelCount } from "./pb-subscription-hub";
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

function makeWrapperProps() {
  const cache: Cache = new Map();
  return ({ children }: { children: ReactNode }) => (
    <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
  );
}

function ProjectionConsumer({
  client,
  out,
}: {
  client: TypedPocketBase;
  out: string[];
}) {
  const res = useLiveRead(
    pbCollectionSource(client, "projection", {
      filter: 'deleted_at = ""',
    }),
  );
  const first = (res.data as { name: string }[] | undefined)?.[0]?.name;
  if (first) out.push(first);
  return null;
}

function OrganizeConsumer({
  client,
  fetcher,
  onData,
}: {
  client: TypedPocketBase;
  fetcher: () => Promise<Result<{ fragments: number }, Error>>;
  onData: (n: number) => void;
}) {
  const res = useLiveRead(
    pbEndpointSource({
      client,
      endpoint: "organize",
      fetch: fetcher,
      watch: ["fragment", "ingest"],
      coalesceMs: 10,
    }),
  );
  if (res.data) onData(res.data.fragments);
  return null;
}

interface MockPbHarness {
  client: TypedPocketBase;
  getFullList: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsub: ReturnType<typeof vi.fn>;
  emit: (collection: string, filter?: string) => void;
}

function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

function createMockPb(baseURL = "http://127.0.0.1:8090"): MockPbHarness {
  const callbacks = new Map<string, Set<() => void>>();
  const getFullList = vi.fn(
    async (_collection: string, _params?: unknown): Promise<unknown[]> => [],
  );
  const unsub = vi.fn();

  const subscribe = vi.fn(
    async (
      _topic: string,
      cb: () => void,
      opts?: { filter?: string },
      collectionName?: string,
    ) => {
      const k = `${collectionName ?? ""}\0${opts?.filter ?? ""}`;
      let set = callbacks.get(k);
      if (!set) {
        set = new Set();
        callbacks.set(k, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
        unsub();
      };
    },
  );

  const client = {
    baseURL,
    collection: (name: string) => ({
      getFullList: (params?: unknown) => getFullList(name, params),
      subscribe: (topic: string, cb: () => void, opts?: { filter?: string }) =>
        subscribe(topic, cb, opts, name),
    }),
  } as unknown as TypedPocketBase;

  return {
    client,
    getFullList,
    subscribe,
    unsub,
    emit: (collection: string, filter?: string) => {
      const set = callbacks.get(`${collection}\0${filter ?? ""}`);
      if (!set) return;
      for (const cb of Array.from(set)) cb();
    },
  };
}

describe("useLiveRead + PocketBase sources", () => {
  test("fetches a collection and revalidates via coalesced, ref-counted SSE subscriptions", async () => {
    const pb = createMockPb();
    let version = 1;
    pb.getFullList.mockImplementation(async () => [
      { id: "p1", name: `Proj v${version}` },
    ]);

    const cache: Cache = new Map();
    const seenA: string[] = [];
    const seenB: string[] = [];

    const { unmount } = render(
      <TestSWRProvider cache={cache}>
        <ProjectionConsumer client={pb.client} out={seenA} />
        <ProjectionConsumer client={pb.client} out={seenB} />
      </TestSWRProvider>,
    );

    await waitFor(() => {
      expect(last(seenA)).toBe("Proj v1");
      expect(last(seenB)).toBe("Proj v1");
    });

    // Two mounted consumers must share a single PocketBase SSE channel.
    expect(pb.subscribe).toHaveBeenCalledTimes(1);
    expect(_pbHubChannelCount(pb.client)).toBe(1);

    // Burst of 3 SSE events coalesces into a single revalidation.
    version = 2;
    const callsBefore = pb.getFullList.mock.calls.length;
    act(() => {
      pb.emit("projection", 'deleted_at = ""');
      pb.emit("projection", 'deleted_at = ""');
      pb.emit("projection", 'deleted_at = ""');
    });

    await waitFor(() => {
      expect(last(seenA)).toBe("Proj v2");
      expect(last(seenB)).toBe("Proj v2");
    });
    expect(pb.getFullList.mock.calls.length).toBe(callsBefore + 1);

    unmount();
    expect(pb.unsub).toHaveBeenCalledTimes(1);
    expect(_pbHubChannelCount(pb.client)).toBe(0);
    expect(_liveRegistrySize()).toEqual({ keys: 0, tags: 0 });
  });

  test("pbEndpointSource shares subscriptions across consumers and revalidates when watched collections change", async () => {
    const pb = createMockPb("http://127.0.0.1:8091");
    let count = 0;
    const fetcher = vi.fn(async () => ok({ fragments: ++count }));

    const cache: Cache = new Map();
    const valsA: number[] = [];
    const valsB: number[] = [];

    const { unmount } = render(
      <TestSWRProvider cache={cache}>
        <OrganizeConsumer
          client={pb.client}
          fetcher={fetcher}
          onData={(n) => valsA.push(n)}
        />
        <OrganizeConsumer
          client={pb.client}
          fetcher={fetcher}
          onData={(n) => valsB.push(n)}
        />
      </TestSWRProvider>,
    );

    await waitFor(() => {
      expect(last(valsA)).toBe(1);
      expect(last(valsB)).toBe(1);
    });

    // 2 watched collections total (not 2 * 2 consumers = 4).
    expect(pb.subscribe).toHaveBeenCalledTimes(2);
    expect(_pbHubChannelCount(pb.client)).toBe(2);

    act(() => {
      pb.emit("ingest");
    });

    await waitFor(() => {
      expect(last(valsA)).toBe(2);
      expect(last(valsB)).toBe(2);
    });

    disposeClientSubscriptions(pb.client);
    expect(_pbHubChannelCount(pb.client)).toBe(0);
    unmount();
  });

  test("disabled source (key: null) does not fetch or subscribe", async () => {
    const pb = createMockPb();
    const Wrapper = makeWrapperProps();

    const { result } = renderHook(
      () =>
        useLiveRead(
          pbCollectionSource(pb.client, "colour", { enabled: false }),
        ),
      { wrapper: Wrapper },
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBe("ready");
    expect(pb.getFullList).not.toHaveBeenCalled();
    expect(pb.subscribe).not.toHaveBeenCalled();
  });
});

describe("useLiveRead + atomLiveSource", () => {
  test("pushes atom updates directly into SWR cache via setData", async () => {
    let current = { signedIn: false, email: null as string | null };
    const listeners = new Set<(v: typeof current) => void>();
    const Wrapper = makeWrapperProps();

    const { result } = renderHook(
      () =>
        useLiveRead(
          atomLiveSource({
            key: ["cloud", "session"],
            tags: ["cloud:session"],
            read: () => current,
            subscribe: (fn) => {
              listeners.add(fn);
              return () => listeners.delete(fn);
            },
          }),
        ),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ signedIn: false, email: null });
    });

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

    await act(async () => {
      await clearCloudLiveCache();
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe("useLiveRead + httpLiveSource offlineCache (cloud workspaces exception)", () => {
  test("seeds cached value when offline fetch fails, and reconciles + writes when online", async () => {
    type Workspace = { id: string; name: string; icon?: string };
    let stored: Workspace[] | undefined = [
      { id: "w1", name: "Cached", icon: "star" },
    ];
    let online = false;

    const write = vi.fn(async (next: Workspace[]) => {
      stored = next;
    });

    const Wrapper = makeWrapperProps();
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
      { wrapper: Wrapper },
    );

    // Offline: cached workspace list is surfaced while error reports offline.
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: "w1", name: "Cached", icon: "star" },
      ]);
      expect(result.current.error?.message).toBe("offline");
      expect(result.current.status).toBe("ready");
    });
    expect(write).not.toHaveBeenCalled();

    // Go online and invalidate via tag: reconciles local icon and persists.
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

  test("clearWorkspaceLiveCache evicts workspace-scoped reads", async () => {
    const Wrapper = makeWrapperProps();
    const { result } = renderHook(
      () =>
        useLiveRead(
          httpLiveSource({
            key: ["pb", "http://127.0.0.1:9999", "endpoint", "backups"],
            tags: ["pb:http://127.0.0.1:9999:backups"],
            fetch: async () => ok(["b1"]),
          }),
        ),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(["b1"]);
    });

    await act(async () => {
      await clearWorkspaceLiveCache("http://127.0.0.1:9999");
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe("useExternalWrite", () => {
  test("creates return { status: 'success', id } and invalidate paired non-push live reads before resolving", async () => {
    const backups = ["b1"];
    const Wrapper = makeWrapperProps();

    const { result } = renderHook(
      () => {
        const read = useLiveRead(
          httpLiveSource({
            key: ["pb", "http://local", "endpoint", "backups"],
            tags: ["pb:http://local:backups"],
            fetch: async () => ok([...backups]),
          }),
        );
        const createBackup = useExternalWrite<string, { readonly id: string }>({
          execute: async (id) => {
            backups.push(id);
            return ok({ id });
          },
          invalidates: ["pb:http://local:backups"],
        });
        return { read, createBackup };
      },
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.read.data).toEqual(["b1"]);
    });

    let outcome: WriteOutcome<{ readonly id: string }> | undefined;
    await act(async () => {
      outcome = await result.current.createBackup.run("b2");
    });

    expect(outcome).toEqual({ status: "success", id: "b2" });
    expect(result.current.createBackup.status).toBe("success");
    expect(result.current.createBackup.isPending).toBe(false);
    // Live read has already caught up by the time run() resolved.
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
});
