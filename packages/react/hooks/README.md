# `@kalaido/hooks`

Shared React hooks and contexts for Kalaido, including the hierarchical Valtio state primitive (`@kalaido/hooks/use-scope`).

---

## State Scopes (`@kalaido/hooks/use-scope`)

`createScope` and `useScope` enforce a strict, hierarchical state model on top of Valtio:

- **Own or receive:** Every stateful component either creates its own scope or receives a `StateHandle<S, E>` as a prop.
- **Single-owner mutation:** Only the owner's `handlers` receive the mutable Valtio proxy (and only for the keys that scope owns). Exposed `handle.state` is a separate read-only Valtio proxy storing deeply frozen snapshots — direct top-level or nested writes fail at both compile time and runtime.
- **Parent-defined narrowing:** A parent decides which `state` keys and `events` a child may access. Ungranted keys do not exist on the child's proxy, and ungranted events throw on `dispatch`. A child can narrow further, never widen a parent's permissions.
- **Widening in the same call:** A child can narrow a parent scope and add its own local `initial` state and `handlers` in one `useScope` call, producing a single flat `StateHandle` for its subtree.
- **Async dispatch:** Handlers may be `async`, and `handle.dispatch(event)` always returns `Promise<void>` so callers can `await` transitions.
- **Separate from server fetching:** Server/collection data continues to use SWR (`useCollection` / `useLiveCollection`).

---

### API

Import from `@kalaido/hooks/use-scope` and read state with `useSnapshot` from `valtio/react`:

```ts
import {
  createScope,
  useScope,
  type ScopeEvent,
  type ScopeHandlerContext,
  type ScopeHandlers,
  type ScopeInstance,
  type StateHandle,
} from "@kalaido/hooks/use-scope";
import { useSnapshot } from "valtio/react";
```

| Export                                          | Purpose                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StateHandle<S, E>`                             | `{ readonly state: Snapshot<S>; readonly dispatch: (event: E) => Promise<void> }`                                                                                    |
| `ScopeInstance<S, E>`                           | `StateHandle<S, E>` plus `readonly dispose: () => void` (returned by `createScope`)                                                                                  |
| `createScope(options)`                          | Create, narrow, and/or widen a scope outside React (e.g. app root). Call `dispose()` to clean up subscriptions.                                                      |
| `useScope(options)`                             | React hook equivalent. Returns a stable `StateHandle`, uses the latest `handlers` closure on every render, and cleans up subscriptions across mounts / `StrictMode`. |
| `ScopeHandlers<OwnS, OwnE, ParentS?, ParentE?>` | Optional helper type for exhaustively typing handlers against a pre-declared event union.                                                                            |
| `ScopeHandlerContext<ParentS, ParentE>`         | Optional 3rd handler argument: `{ parent: Snapshot<ParentS>; dispatchParent: (e: ParentE) => Promise<void> }`.                                                       |

---

### Usage

#### 1. Root store outside React (`createScope`)

```ts
type AppState = {
  theme: "light" | "dark" | "system";
  feedbackDialogOpen: boolean;
  latestInferenceRate?: { tokensPerSecond: number; at: number };
};

type AppEvent =
  | { type: "setTheme"; theme: AppState["theme"] }
  | { type: "openFeedback" }
  | { type: "closeFeedback" }
  | { type: "recordInferenceRate"; tokensPerSecond: number };

const handlers: ScopeHandlers<AppState, AppEvent> = {
  setTheme: async (s, e) => {
    s.theme = e.theme;
    await persistTheme(e.theme);
  },
  openFeedback: (s) => {
    s.feedbackDialogOpen = true;
  },
  closeFeedback: (s) => {
    s.feedbackDialogOpen = false;
  },
  recordInferenceRate: (s, e) => {
    s.latestInferenceRate = {
      tokensPerSecond: e.tokensPerSecond,
      at: Date.now(),
    };
  },
};

export const appScope = createScope({
  initial: (): AppState => ({
    theme: "system",
    feedbackDialogOpen: false,
  }),
  handlers,
});
```

#### 2. Component-owned local state (`useScope`)

Events are inferred directly from `handlers` when you don't pre-declare a union:

```tsx
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
      cancel: (s) => {
        s.editing = false;
      },
      commit: async (s) => {
        s.editing = false;
        await onSave(s.draft.trim());
      },
    },
  });

  const { editing, draft } = useSnapshot(local.state);
  // ...
}
```

#### 3. Parent-defined narrowing

Both `state` and `events` default to `[]` when omitted:

```tsx
// Read + write subset
const themeScope = useScope({
  from: app,
  state: ["theme"],
  events: ["setTheme"],
});

// Read-only (cannot dispatch anything)
const rateScope = useScope({
  from: app,
  state: ["latestInferenceRate"],
});

// Write-only (empty state, never triggers re-renders)
const feedbackButtonScope = useScope({
  from: app,
  events: ["openFeedback"],
});
```

#### 4. Narrow + widen in one call

Inherited parent keys are read-only; `handlers` receive only the mutable own state as `s`, plus optional `ctx` (`{ parent, dispatchParent }`) to read granted parent state or forward granted parent events:

```tsx
function ExploreScreen({
  parent,
}: {
  parent: StateHandle<
    { activeWorkspaceId: string },
    { type: "recordInferenceRate"; tokensPerSecond: number }
  >;
}) {
  const explore = useScope({
    from: parent,
    state: ["activeWorkspaceId"],
    events: ["recordInferenceRate"],
    initial: () => ({ historyOpen: true, selectedId: null as string | null }),
    handlers: {
      setHistoryOpen: (s, e: { type: "setHistoryOpen"; open: boolean }) => {
        s.historyOpen = e.open;
      },
      selectConversation: async (
        s,
        e: { type: "selectConversation"; id: string },
        ctx,
      ) => {
        // ctx.parent.activeWorkspaceId is read-only; s only has own keys
        s.selectedId = e.id;
        await ctx.dispatchParent({
          type: "recordInferenceRate",
          tokensPerSecond: 0,
        });
      },
    },
  });

  // Narrow again for a child, mixing inherited and own keys/events:
  const chatScope = useScope({
    from: explore,
    state: ["selectedId"],
    events: ["recordInferenceRate"],
  });

  const { historyOpen } = useSnapshot(explore.state);
  return <ChatPanel scope={chatScope} showHistory={historyOpen} />;
}
```

#### 5. Bridging into `@kalaido/primitives`

`@kalaido/primitives` stays Valtio-free. Stateful components read `useSnapshot(scope.state)` and pass plain values + callbacks down to primitives:

```tsx
const { theme } = useSnapshot(scope.state);
return (
  <ThemeToggle
    value={theme}
    onChange={(next) => void scope.dispatch({ type: "setTheme", theme: next })}
  />
);
```

---

### Rules & Caveats

- **No collisions:** Own `initial` keys cannot collide with forwarded `state` keys, and own `handlers` names cannot collide with forwarded `events` names (rejected at compile time and runtime). Names that were _not_ forwarded from `from` can be reused freely.
- **Key-level granularity:** Each key on `handle.state` holds a deeply frozen snapshot wrapped in Valtio's `ref()`. Top-level keys track independently in `useSnapshot`, while reading inside a nested object under a single key re-renders whenever anything inside that key changes. Keep top-level state keys reasonably flat when sub-fields update independently.
- **Stable scope identity:** `useScope` preserves the same `StateHandle` across renders as long as `from`, the `state` key list, and the `events` list are unchanged (inline array literals are compared by value). Changing `from` or the narrowed key/event list rebuilds the scope.
- **No direct mutations:** Attempting `(handle.state as any).x = ...` or mutating nested arrays/objects throws a `TypeError` synchronously and reverts the view proxy without affecting the owner.
