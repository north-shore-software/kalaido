# `@kalaido/state`

A small, opinionated React state library built on **Valtio**, **SWR**, and **neverthrow** that enforces a hard boundary between **local client state** and **external persistent state**.

## Mental Model

| Category                            | Primitive                                    | Ownership & Data Flow                                                                                                                    |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Local in-memory state**           | `createScope` / `useScope` + `useScopeState` | Single-owner Valtio scopes with read-only snapshots, explicit `dispatch(event)` mutations, and parent-defined narrowing.                 |
| **Local persisted state**           | `createScope` / `useScope` with `persist`    | Same scope API with explicit boot hydration (`hydrate()`) and transparent, optimistic, serialized background write-through.              |
| **External persistent reads**       | `useLiveRead(source)`                        | Single server-authoritative live-read contract across push and non-push backends. No manual `refresh()` escape hatch.                    |
| **External persistent writes**      | `useExternalWrite(def)`                      | Paired async command hook returning status (`"success" \| "ignored" \| "error"`) and created ID(s) only — never updated entity payloads. |
| **PocketBase adapter** _(optional)_ | `@kalaido/state/pocketbase`                  | Ref-counted SSE subscription hub + `pbCollectionSource` / `pbEndpointSource` for PocketBase backends.                                    |

---

## Entrypoints

```ts
// Core (re-exports ./scope and ./live — zero backend SDK dependencies)
import {
  createScope,
  useScope,
  useScopeState,
  useLiveRead,
  useExternalWrite,
  httpLiveSource,
  atomLiveSource,
  invalidateLiveTags,
  clearLiveCache,
} from "@kalaido/state";

// Focused subpaths
import { createScope, useScope, useScopeState } from "@kalaido/state/scope";
import { useLiveRead, useExternalWrite } from "@kalaido/state/live";

// Optional PocketBase adapter (requires optional peer dependency `pocketbase`)
import {
  pbCollectionSource,
  pbEndpointSource,
  disposeClientSubscriptions,
  clearPocketBaseLiveCache,
} from "@kalaido/state/pocketbase";
```

---

## Part 1: Scoped Local State (`@kalaido/state/scope`)

`createScope` and `useScope` enforce a strict hierarchical state model on top of Valtio:

- **Own or receive:** Every stateful component either creates its own scope or receives a `StateHandle<S, E>` from a parent.
- **Single-owner mutation:** Only the owner's `handlers` receive the mutable Valtio proxy (and only for keys that scope owns). Exposed `handle.state` is a separate read-only Valtio proxy storing deeply frozen snapshots — direct top-level or nested mutations fail at compile time and throw `TypeError` at runtime.
- **Parent-defined narrowing:** A parent selects which `state` keys and `events` a child may access. Ungranted keys do not exist on the child's proxy, and ungranted events throw on `dispatch`. Children can narrow further, never widen a parent's permissions.
- **Narrow + widen in one call:** A child can narrow a parent scope and attach its own `initial` state and `handlers` in a single `useScope` call, producing one flat `StateHandle` for its subtree.
- **Async dispatch:** Handlers may be `async`; `handle.dispatch(event)` always returns `Promise<void>`.

### Exports

| Export                                          | Purpose                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `StateHandle<S, E>`                             | `{ readonly state: Snapshot<S>; readonly dispatch: (event: E) => Promise<void> }`                                                |
| `ScopeInstance<S, E>`                           | `StateHandle<S, E>` + `dispose()` (returned by `createScope`)                                                                    |
| `PersistedStateHandle<S, E>`                    | `StateHandle<S, E>` + `hydrate()`, `flush()`, `getHydrationStatus()` (returned by `useScope` when `persist` is provided)         |
| `PersistedScopeInstance<S, E>`                  | `ScopeInstance<S, E>` + `PersistedStateHandle<S, E>` (returned by `createScope` when `persist` is provided)                      |
| `createScope(options)`                          | Create, narrow, and/or widen a scope outside React (e.g. app root).                                                              |
| `useScope(options)`                             | React hook equivalent. Returns a stable handle across renders, keeps handler closures fresh on commit, and handles `StrictMode`. |
| `useScopeState(scope, options?)`                | Typed React hook wrapping Valtio's `useSnapshot(scope.state, options)`.                                                          |
| `ScopeHandlers<OwnS, OwnE, ParentS?, ParentE?>` | Helper type for exhaustively typing handlers against a pre-declared event union.                                                 |
| `ScopeHandlerContext<ParentS, ParentE>`         | Optional 3rd handler argument: `{ parent: Snapshot<ParentS>; dispatchParent(e) }`.                                               |
| `ScopePersistenceAdapter<T>`                    | Storage contract (`load`, `save`, `remove`) for transparent persistence.                                                         |

### 1.1 Root Scope Outside React (`createScope`)

```ts
import { createScope, type ScopeHandlers } from "@kalaido/state/scope";

type AppState = {
  theme: "light" | "dark" | "system";
  modalOpen: boolean;
};

type AppEvent =
  | { type: "setTheme"; theme: AppState["theme"] }
  | { type: "openModal" }
  | { type: "closeModal" };

const handlers: ScopeHandlers<AppState, AppEvent> = {
  setTheme: (s, e) => {
    s.theme = e.theme;
  },
  openModal: (s) => {
    s.modalOpen = true;
  },
  closeModal: (s) => {
    s.modalOpen = false;
  },
};

export const appScope = createScope({
  initial: (): AppState => ({ theme: "system", modalOpen: false }),
  handlers,
});
```

### 1.2 Component-Owned Local State (`useScope`)

Events are inferred directly from `handlers` when no union is pre-declared:

```tsx
import { useScope, useScopeState } from "@kalaido/state/scope";

function EditableTitle({ initialTitle, onSave }: Props) {
  const local = useScope({
    initial: () => ({ editing: false, draft: initialTitle }),
    handlers: {
      start: (s) => {
        s.draft = initialTitle;
        s.editing = true;
      },
      change: (s, e: { type: "change"; value: string }) => {
        s.draft = e.value;
      },
      commit: async (s) => {
        s.editing = false;
        await onSave(s.draft.trim());
      },
    },
  });

  const { editing, draft } = useScopeState(local);
  // ...
}
```

### 1.3 Parent-Defined Narrowing & Widening

Both `state` and `events` default to `[]` when omitted:

```tsx
// Read + write subset
const themeScope = useScope({
  from: appScope,
  state: ["theme"],
  events: ["setTheme"],
});

// Read-only (cannot dispatch anything)
const readOnlyScope = useScope({
  from: appScope,
  state: ["theme"],
});

// Narrow parent + widen with local state in one call
const panelScope = useScope({
  from: appScope,
  state: ["theme"],
  events: ["openModal"],
  initial: () => ({ selectedTab: "overview" }),
  handlers: {
    selectTab: (s, e: { type: "selectTab"; tab: string }, ctx) => {
      // ctx.parent.theme is read-only; s contains only own keys
      s.selectedTab = e.tab;
    },
  },
});
```

### 1.4 Transparent Optimistic Persistence (`persist`)

Any owned scope (`createScope` or `useScope`) can declare a subset of its own keys to persist transparently through a `ScopePersistenceAdapter`:

```ts
import { createScope, type ScopePersistenceAdapter } from "@kalaido/state/scope";

const storageAdapter: ScopePersistenceAdapter<{ theme: "light" | "dark" | "system" }> = {
  load: async () => /* Result<Partial<...>, Error> */,
  save: async (key, value) => /* Result<void, Error> */,
  remove: async (key) => /* Result<void, Error> */,
};

const root = createScope({
  initial: () => ({
    stage: "bootstrap" as "bootstrap" | "ready" | "error",
    theme: "system" as "light" | "dark" | "system",
  }),
  handlers: {
    setTheme: (s, e: { type: "setTheme"; theme: "light" | "dark" | "system" }) => {
      s.theme = e.theme;
    },
  },
  persist: {
    keys: ["theme"] as const,
    adapter: storageAdapter,
    onHydrated: (s, result) => {
      s.stage = result.isOk() ? "ready" : "error";
    },
    onWriteError: (key, error) => {
      console.error(`Failed to persist ${key}:`, error);
    },
  },
});

// Explicit hydration gate (e.g. at app boot behind a splash screen):
await root.hydrate();

// Subsequent dispatches update memory immediately and flush in the background:
await root.dispatch({ type: "setTheme", theme: "dark" });
```

**Persistence guarantees:**

- **Explicit hydration:** Nothing is loaded or written until `scope.hydrate()` is called. Concurrent `hydrate()` calls deduplicate; failed loads allow retry.
- **No echo writes:** Values applied during `hydrate()` (including inside `onHydrated`) never echo back to `adapter.save()`.
- **Dirty-key protection:** Keys already mutated via `dispatch()` before `hydrate()` resolves are not overwritten by stale disk data.
- **Per-key serialization & coalescing:** Rapid mutations to the same key are queued sequentially and intermediate pending values coalesce so the latest value always wins on disk.
- **Delete on `undefined`:** Setting a persisted key to `undefined` or deleting it invokes `adapter.remove(key)`.
- **Optimistic error model:** Failed writes never roll back in-memory state; they report to `onWriteError` (default `console.error`).
- **Dispose safety:** Calling `dispose()` stops observing future changes while allowing already-queued writes to finish (`await scope.flush()`).

### 1.5 Scope Rules & Caveats

- **No collisions:** Own `initial` keys cannot collide with forwarded parent `state` keys, and own `handlers` cannot collide with forwarded `events` (enforced at compile time and runtime). Unforwarded names may be reused freely.
- **Deeply frozen plain values:** Plain objects and arrays on `handle.state` are deeply frozen without Valtio `ref()`, preserving nested `useScopeState` path tracking while rejecting any direct mutation with `TypeError`. Non-plain instances (`Date`, `Map`, `Set`, `Uint8Array`, etc.) are left untouched.
- **Stable handle identity:** `useScope` preserves handle identity as long as `from`, `state`, `events`, owned `handlers` keys, and `persist.keys` are unchanged.

---

## Part 2: External Live Reads (`@kalaido/state/live`)

All reads from external persistent stores share a single caller contract (`LiveReadResult<T>`) powered by SWR, parameterized by a small `LiveSource<T>` adapter.

```ts
export interface LiveReadResult<T> {
  readonly data: T | undefined;
  readonly status: "loading" | "ready" | "error";
  readonly isLoading: boolean; // true only before initial data arrives
  readonly isValidating: boolean; // true during any in-flight fetch/revalidation
  readonly error: Error | null;
}
```

**Why there is no `refresh()` method:** Liveness is owned strictly by the source adapter (realtime push where supported, paired-write tag invalidation + focus/reconnect where not). Removing manual `refresh()` prevents callers from reverting to ad-hoc imperative refetch plumbing.

### Built-in Source Adapters

#### `httpLiveSource` — Non-push HTTP / REST (with optional offline cache)

```ts
import { httpLiveSource, useLiveRead } from "@kalaido/state/live";

function useBackups(workspaceId: string) {
  return useLiveRead(
    httpLiveSource({
      key: ["backups", workspaceId],
      tags: [`backups:${workspaceId}`],
      fetch: () => fetchBackups(workspaceId), // Promise<Result<Backup[], Error>>
    }),
  );
}
```

For external lists that must remain visible offline (reconciling when online), pass `offlineCache: { read, reconcile, write }`:

- When offline, `read()` seeds `data` while `error` surfaces the network failure (`status` stays `"ready"` so cached entries render).
- When online, `fetch()` runs `reconcile(cached, fresh)`, persists via `write()`, and updates the SWR cache.

#### `atomLiveSource` — External Reactive Store / Atom Bridge

```ts
import { atomLiveSource, useLiveRead } from "@kalaido/state/live";

function useAuthSession() {
  return useLiveRead(
    atomLiveSource({
      key: ["auth", "session"],
      tags: ["auth:session"],
      read: () => sessionAtom.get(),
      subscribe: (cb) => sessionAtom.subscribe(cb),
    }),
  );
}
```

### Shared Deduplication & Teardown

- Multiple mounted components reading the same `(cache, key)` share **one** push subscription, **one** coalescing timer, and **one** SWR revalidation per event or tag invalidation.
- `invalidateLiveTags(tags)` revalidates every mounted live read claiming a matching tag.
- `clearLiveCache(matchesRawKey, matchesSerializedKey?)` evicts matching cached reads (e.g. on sign-out or workspace switch).

---

## Part 3: Paired External Writes (`@kalaido/state/live`)

`useExternalWrite` pairs with `useLiveRead` to enforce unidirectional CQRS data flow:

- **Compile-time `WriteReturn` constraint:** `execute` may only return `Result<void, Error>`, `Result<{ readonly id: string }, Error>`, or `Result<{ readonly ids: readonly string[] }, Error>`. Returning full entity records is rejected by TypeScript — updated state always arrives through `useLiveRead`.
- **Default `concurrency: "ignore"`:** Calling `run()` while a write is already in flight returns `{ status: "ignored" }` immediately without firing a duplicate request. Opt into `concurrency: "allow"` for independent parallel writes.
- **Awaited tag invalidation:** On `ok`, `run()` awaits `invalidateLiveTags(invalidates)` before resolving so paired non-push live reads are already fresh.
- **Never throws:** `run()` always resolves to a discriminated `WriteOutcome<TOut>`:
  - `{ status: "success" }` (plus `id` or `ids` for creates)
  - `{ status: "ignored" }`
  - `{ status: "error", error: Error }`

```ts
import { useExternalWrite } from "@kalaido/state/live";

const createBackup = useExternalWrite<void, { readonly id: string }>({
  execute: () => api.createBackup(),
  invalidates: [`backups:${workspaceId}`],
});

const outcome = await createBackup.run();
if (outcome.status === "success") {
  console.log("Created:", outcome.id);
} else if (outcome.status === "error") {
  toast.error(outcome.error.message);
}
```

---

## Part 4: PocketBase Adapter (`@kalaido/state/pocketbase`)

An optional subpath (with `pocketbase` as an optional peer dependency) providing two `LiveSource` adapters backed by a **ref-counted SSE subscription hub** (`WeakMap<PocketBase, ...>`):

- **`pbCollectionSource(client, collection, query?, options?)`** — Fetches via `getFullList({ ...params, requestKey: null })` and subscribes via the shared SSE hub on `[collection]` (or `options.watch` for SQL views), coalescing bursts (default `50ms`).
- **`pbEndpointSource({ client, endpoint, params?, fetch, watch, coalesceMs?, tags?, enabled? })`** — Fetches a custom PocketBase HTTP endpoint and revalidates whenever any collection in `watch` emits an SSE event.
- **`disposeClientSubscriptions(client)`** — Tears down all active SSE channels on a PocketBase client (e.g. on workspace switch).
- **`clearPocketBaseLiveCache(baseURL)`** — Evicts all cached PocketBase live reads scoped to `baseURL`.

```ts
import { useLiveRead } from "@kalaido/state/live";
import {
  pbCollectionSource,
  pbEndpointSource,
} from "@kalaido/state/pocketbase";

const tasks = useLiveRead(
  pbCollectionSource<TaskRecord>(pb, "tasks", {
    filter: "archived = false",
    sort: "-created",
  }),
);

const summary = useLiveRead(
  pbEndpointSource({
    client: pb,
    endpoint: "dashboard-summary",
    fetch: () => fetchDashboardSummary(pb),
    watch: ["tasks", "projects"],
    coalesceMs: 300,
  }),
);
```
