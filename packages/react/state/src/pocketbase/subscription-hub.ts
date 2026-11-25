import type PocketBase from "pocketbase";

interface HubEntry {
  readonly listeners: Set<() => void>;
  unsub: (() => void) | null;
  disposed: boolean;
}

/**
 * Ref-counted PocketBase SSE subscription hub scoped per client instance.
 *
 * Multiple mounted hooks watching the same `(client, collection, filter)`
 * share a single PocketBase `.subscribe("*", ...)` channel. When the last
 * listener unsubscribes, the channel is closed cleanly (including when unmount
 * races ahead of the async `subscribe` promise resolving).
 */
const entriesByClient = new WeakMap<PocketBase, Map<string, HubEntry>>();

function channelKey(collection: string, filter?: string): string {
  return `${collection}\0${filter ?? ""}`;
}

function getClientMap(client: PocketBase): Map<string, HubEntry> {
  let map = entriesByClient.get(client);
  if (!map) {
    map = new Map();
    entriesByClient.set(client, map);
  }
  return map;
}

function teardownEntry(
  map: Map<string, HubEntry>,
  key: string,
  entry: HubEntry,
): void {
  if (entry.disposed) return;
  entry.disposed = true;
  entry.listeners.clear();
  if (map.get(key) === entry) {
    map.delete(key);
  }
  if (entry.unsub) {
    const fn = entry.unsub;
    entry.unsub = null;
    void Promise.resolve(fn()).catch(() => {});
  }
}

export function subscribePbCollection(
  client: PocketBase,
  collection: string,
  listener: () => void,
  filter?: string,
): () => void {
  const map = getClientMap(client);
  const key = channelKey(collection, filter);

  let entry = map.get(key);
  if (!entry) {
    const created: HubEntry = {
      listeners: new Set(),
      unsub: null,
      disposed: false,
    };
    map.set(key, created);
    entry = created;

    const opts = filter ? { filter } : undefined;
    void (async () => {
      try {
        const unsub = await client.collection(collection).subscribe(
          "*",
          () => {
            if (created.disposed) return;
            for (const fn of Array.from(created.listeners)) {
              fn();
            }
          },
          opts,
        );
        if (created.disposed) {
          void Promise.resolve(unsub()).catch(() => {});
          return;
        }
        created.unsub = unsub;
      } catch (err) {
        if (!created.disposed) {
          console.error(
            `pbSubscriptionHub(${collection}): subscribe failed`,
            err,
          );
          if (map.get(key) === created) {
            map.delete(key);
          }
          created.disposed = true;
        }
      }
    })();
  }

  entry.listeners.add(listener);
  const currentEntry = entry;

  return () => {
    currentEntry.listeners.delete(listener);
    if (currentEntry.listeners.size === 0) {
      teardownEntry(map, key, currentEntry);
    }
  };
}

/** Tear down every active SSE channel for a client (e.g. on workspace switch). */
export function disposeClientSubscriptions(client: PocketBase): void {
  const map = entriesByClient.get(client);
  if (!map) return;
  for (const [key, entry] of Array.from(map.entries())) {
    teardownEntry(map, key, entry);
  }
  entriesByClient.delete(client);
}

/** Test-only helper returning the number of active channels on a client. */
export function _pbHubChannelCount(client: PocketBase): number {
  return entriesByClient.get(client)?.size ?? 0;
}
