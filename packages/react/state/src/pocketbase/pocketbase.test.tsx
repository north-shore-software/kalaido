import { act, render, renderHook, waitFor } from "@testing-library/react";
import { ok, type Result } from "neverthrow";
import type PocketBase from "pocketbase";
import type { ReactNode } from "react";
import { type Cache, SWRConfig } from "swr";
import { useLiveRead } from "#live";
import { _liveRegistrySize, invalidateLiveTags } from "../live/registry";
import {
  clearPocketBaseLiveCache,
  disposeClientSubscriptions,
  pbCollectionSource,
  pbCollectionTag,
  pbEndpointSource,
} from "./index";
import { _pbHubChannelCount } from "./subscription-hub";

function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

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

interface MockPbHarness {
  client: PocketBase;
  getFullList: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsub: ReturnType<typeof vi.fn>;
  emit: (collection: string, filter?: string) => void;
}

function createMockPb(
  baseURL = "http://127.0.0.1:8090",
  onBeforeSubscribe?: (attempt: number) => void,
): MockPbHarness {
  const callbacks = new Map<string, Set<() => void>>();
  const getFullList = vi.fn(
    async (_collection: string, _params?: unknown): Promise<unknown[]> => [],
  );
  const unsub = vi.fn();
  let subscribeAttempts = 0;

  const subscribe = vi.fn(
    async (
      _topic: string,
      cb: () => void,
      opts?: { filter?: string },
      collectionName?: string,
    ) => {
      subscribeAttempts += 1;
      onBeforeSubscribe?.(subscribeAttempts);
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
  } as unknown as PocketBase;

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

function ItemsConsumer({ client, out }: { client: PocketBase; out: string[] }) {
  const res = useLiveRead(
    pbCollectionSource<{ id: string; name: string }>(client, "items", {
      filter: 'deleted_at = ""',
    }),
  );
  const first = res.data?.[0]?.name;
  if (first) out.push(first);
  return null;
}

function StatusConsumer({
  client,
  fetcher,
  onData,
}: {
  client: PocketBase;
  fetcher: () => Promise<Result<{ count: number }, Error>>;
  onData: (n: number) => void;
}) {
  const res = useLiveRead(
    pbEndpointSource({
      client,
      endpoint: "status",
      fetch: fetcher,
      watch: ["items", "jobs"],
      coalesceMs: 10,
    }),
  );
  if (res.data) onData(res.data.count);
  return null;
}

describe("@kalaido/state/pocketbase", () => {
  test("fetches a collection and revalidates via coalesced, ref-counted SSE subscriptions", async () => {
    const pb = createMockPb();
    let version = 1;
    pb.getFullList.mockImplementation(async () => [
      { id: "1", name: `Item v${version}` },
    ]);

    const cache: Cache = new Map();
    const seenA: string[] = [];
    const seenB: string[] = [];

    const { unmount } = render(
      <TestSWRProvider cache={cache}>
        <ItemsConsumer client={pb.client} out={seenA} />
        <ItemsConsumer client={pb.client} out={seenB} />
      </TestSWRProvider>,
    );

    await waitFor(() => {
      expect(last(seenA)).toBe("Item v1");
      expect(last(seenB)).toBe("Item v1");
    });

    expect(pb.subscribe).toHaveBeenCalledTimes(1);
    expect(_pbHubChannelCount(pb.client)).toBe(1);

    version = 2;
    const callsBefore = pb.getFullList.mock.calls.length;
    act(() => {
      pb.emit("items", 'deleted_at = ""');
      pb.emit("items", 'deleted_at = ""');
      pb.emit("items", 'deleted_at = ""');
    });

    await waitFor(() => {
      expect(last(seenA)).toBe("Item v2");
      expect(last(seenB)).toBe("Item v2");
    });
    expect(pb.getFullList.mock.calls.length).toBe(callsBefore + 1);

    unmount();
    expect(pb.unsub).toHaveBeenCalledTimes(1);
    expect(_pbHubChannelCount(pb.client)).toBe(0);
    expect(_liveRegistrySize()).toEqual({ keys: 0, tags: 0 });
  });

  test("pbEndpointSource shares subscriptions across consumers and supports clearPocketBaseLiveCache", async () => {
    const pb = createMockPb("http://127.0.0.1:8091");
    let count = 0;
    const fetcher = vi.fn(async () => ok({ count: ++count }));

    const cache: Cache = new Map();
    const valsA: number[] = [];
    const valsB: number[] = [];

    const { unmount } = render(
      <TestSWRProvider cache={cache}>
        <StatusConsumer
          client={pb.client}
          fetcher={fetcher}
          onData={(n) => valsA.push(n)}
        />
        <StatusConsumer
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

    expect(pb.subscribe).toHaveBeenCalledTimes(2);
    expect(_pbHubChannelCount(pb.client)).toBe(2);

    act(() => {
      pb.emit("jobs");
    });

    await waitFor(() => {
      expect(last(valsA)).toBe(2);
      expect(last(valsB)).toBe(2);
    });

    disposeClientSubscriptions(pb.client);
    expect(_pbHubChannelCount(pb.client)).toBe(0);
    unmount();
  });

  test("clearPocketBaseLiveCache evicts cached entries for a baseURL", async () => {
    const pb = createMockPb("http://127.0.0.1:9999");
    pb.getFullList.mockResolvedValue([{ id: "1", name: "A" }]);
    const cache: Cache = new Map();

    const { result } = renderHook(
      () =>
        useLiveRead(
          pbCollectionSource<{ id: string; name: string }>(pb.client, "items"),
        ),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "1", name: "A" }]);
    });

    await act(async () => {
      await clearPocketBaseLiveCache("http://127.0.0.1:9999");
    });
    expect(result.current.data).toBeUndefined();
  });

  test("clearPocketBaseLiveCache matches exact baseURL without evicting prefix-colliding servers", async () => {
    const pbA = createMockPb("http://127.0.0.1:8090");
    const pbB = createMockPb("http://127.0.0.1:80900");
    pbA.getFullList.mockResolvedValue([{ id: "a", name: "ServerA" }]);
    pbB.getFullList.mockResolvedValue([{ id: "b", name: "ServerB" }]);
    const cache: Cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
    );

    const hookA = renderHook(
      () => useLiveRead(pbCollectionSource(pbA.client, "items")),
      { wrapper },
    );
    const hookB = renderHook(
      () => useLiveRead(pbCollectionSource(pbB.client, "items")),
      { wrapper },
    );

    await waitFor(() => {
      expect(hookA.result.current.data).toEqual([{ id: "a", name: "ServerA" }]);
      expect(hookB.result.current.data).toEqual([{ id: "b", name: "ServerB" }]);
    });

    hookA.unmount();
    hookB.unmount();

    await clearPocketBaseLiveCache("http://127.0.0.1:8090");
    expect(Array.from(cache.keys()).some((k) => k.includes("80900"))).toBe(
      true,
    );
    expect(
      Array.from(cache.keys()).some((k) =>
        k.includes('"http://127.0.0.1:8090"'),
      ),
    ).toBe(false);
  });

  test("re-subscribes when PocketBase client instance changes for the same baseURL", async () => {
    const pb1 = createMockPb("https://s.kalaido.co/ws1");
    const pb2 = createMockPb("https://s.kalaido.co/ws1");
    let v = 1;
    pb1.getFullList.mockImplementation(async () => [
      { id: "1", name: `v${v}` },
    ]);
    pb2.getFullList.mockImplementation(async () => [
      { id: "1", name: `v${v}` },
    ]);

    const cache: Cache = new Map();
    const { result, rerender, unmount } = renderHook(
      ({ client }) =>
        useLiveRead(
          pbCollectionSource<{ id: string; name: string }>(
            client,
            "items",
            undefined,
            {
              coalesceMs: 10,
            },
          ),
        ),
      {
        initialProps: { client: pb1.client },
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "1", name: "v1" }]);
      expect(pb1.subscribe).toHaveBeenCalledTimes(1);
    });

    disposeClientSubscriptions(pb1.client);
    rerender({ client: pb2.client });

    await waitFor(() => {
      expect(pb2.subscribe).toHaveBeenCalledTimes(1);
    });

    v = 2;
    act(() => {
      pb2.emit("items");
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "1", name: "v2" }]);
    });

    unmount();
  });

  test("recovers SSE subscription on revalidation after initial subscribe() failure and catches up post-connect", async () => {
    let version = 1;
    const pb = createMockPb("http://127.0.0.1:8095", (attempt) => {
      if (attempt === 1) {
        throw new Error("SSE offline");
      }
      // Simulate a mutation landing after the revalidation GET started, right as SSE connects
      queueMicrotask(() => {
        version = 2;
      });
    });
    pb.getFullList.mockImplementation(async () => [
      { id: "1", name: `v${version}` },
    ]);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache: Cache = new Map();

    const { result, unmount } = renderHook(
      () =>
        useLiveRead(
          pbCollectionSource<{ id: string; name: string }>(
            pb.client,
            "items",
            undefined,
            { coalesceMs: 10 },
          ),
        ),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <TestSWRProvider cache={cache}>{children}</TestSWRProvider>
        ),
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "1", name: "v1" }]);
    });
    expect(_pbHubChannelCount(pb.client)).toBe(0);

    // Triggering revalidation (like reconnect/focus or tag invalidation) re-attaches SSE and catches up to v2
    await act(async () => {
      await invalidateLiveTags([pbCollectionTag(pb.client.baseURL, "items")]);
    });

    await waitFor(() => {
      expect(_pbHubChannelCount(pb.client)).toBe(1);
      expect(result.current.data).toEqual([{ id: "1", name: "v2" }]);
    });

    // Subsequent SSE events on the recovered channel trigger live updates
    version = 3;
    act(() => {
      pb.emit("items");
    });
    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "1", name: "v3" }]);
    });

    errSpy.mockRestore();
    unmount();
  });
});
