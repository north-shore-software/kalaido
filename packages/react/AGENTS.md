# Agent Instructions — React Layer (`packages/react/*` & `apps/*/src/`)

Prescriptive React, accessibility, modal, data-flow, and module conventions for Kalaido. Read alongside root `AGENTS.md`, `apps/desktop/DESIGN.md` (for UI and design-system tokens/rules), and `packages/react/state/README.md` (for `@kalaido/state` scopes and CQRS live reads/writes).

## Health Gate & `doctor.config.json`

- Every React change must keep `./kalaido.sh doctor:react . --no-cache --verbose --yes` at **`100 / 100` (`0` errors, `0` warnings)** in addition to `./kalaido.sh test:ts && ./kalaido.sh check:ts`.
- Never add inline `react-doctor-disable` comments or `ignore.overrides` without explicit human direction.
- **Monorepo glob rule:** `react-doctor` scans each workspace package with that package's directory as cwd. Any path pattern in root `doctor.config.json` (`ignore.files` or `ignore.overrides[].files`) must include **both** the repo-root path and the package-relative path (e.g. `"packages/react/primitives/src/shadcn/**"` and `"src/shadcn/**"`), or workspace scans will silently miss it.

## Render Purity, Refs & State Transitions

- **Pure render bodies:** Never read or write `ref.current` (or `ref.current.<prop>`) during render, and never pass eager factory calls (`useRef(compute())`) to `useRef`.
- **Post-commit latest-value refs (`useSyncRef`):** Declare a native `useRef` from `"react"` and sync it via `useSyncRef` (`@kalaido/hooks/use-sync-ref`, or `#use-sync-ref` inside `@kalaido/hooks`), grouping multiple values into a single ref object when practical:
  ```ts
  const latestRef = useRef({ context, timeWindow, onTurnComplete });
  useSyncRef(latestRef, { context, timeWindow, onTurnComplete });
  ```
  Always keep literal `useRef` at the call site — Biome and `react-doctor/exhaustive-deps` recognize `useRef` by hook name as stable, whereas custom ref-returning wrapper hooks (`useLatestRef`) force ref variables into `useEffect` / `useCallback` dependency arrays. Inside `@kalaido/primitives` or `@kalaido/state` (which cannot import `@kalaido/hooks`), use an inline `useLayoutEffect`.
- **Prop-driven & monotonic state:** Never mirror or clamp props/inputs into state inside `useEffect`. Prefer pure render derivation; when state must genuinely latch or reset on a transition (e.g. monotonic `if (next > highWater) setHighWater(next)` or modal `prevOpen` session counters), adjust `useState` during render behind a strict guard.

## Unidirectional Data Flow, Controllers & Redirects

- **No upward `useEffect` sync:** Never mirror child or hook state upward via `useEffect(() => onXChange(x), [x])` or push fetched records into another hook imperatively (`useEffect(() => session.resume(data))`).
- **Own controllers at the parent; pass seeds downward:**
  - Lift stateful controllers to the owning screen or session hook (`useKalaidoChat` in `@kalaido/hooks/use-kalaido-chat`, `useChatContextSelection`) so parent and view read the same `useSyncExternalStore` / scope snapshot in a single render pass. Trigger initial prompts and parameter re-applies imperatively from event/action methods (`openAndSend`, `applyTimeWindow`) rather than reactive `useEffect` watchers.
  - Pass async initial/resumed state *into* stateful hooks as declarative `seed` / `resumed` inputs (`useRefineSession`, `useDraftName`, `useProjectionRefinement`) resolved via pure module-scope helpers while local override state is unset.
- **Post-write settlement (CQRS):** `useExternalWrite` returns `void | { id } | { ids }` only. When post-mutation navigation depends on server-settled state, query the read helper directly inside the async event handler after `await write.run(...)` instead of storing a pending-navigation flag in state and watching live collections in `useEffect`.
- **Router-free screen redirects:** `packages/*` cannot import `react-router-dom`, and `apps/desktop` forbids `Navigate` outside `apps/desktop/src/routes/`. When a shared screen in `@kalaido/features` must canonicalize the URL on live data, expose an optional render prop (e.g. `renderReviewRedirect?: (...) => ReactNode`) evaluated during render, and supply `<AppRedirect transition={...} replace />` (`apps/desktop/src/routes/app-redirect.tsx`) from the desktop page wrapper.

## Modals, Dialogs & Focus (`@base-ui/react`)

- **Preserve Base UI's `100ms` exit animation (`<InnerBody key={sessionKey} />`):** `shadcn/dialog.tsx` wraps `@base-ui/react/dialog`, where `DialogPortal` stays unmounted when closed, keeps `DialogContent` mounted for `100ms` during `data-closed` fade-out, and then unmounts.
  - **Never write `{open && <InnerForm />}` inside `<DialogContent>`** (collapses the modal into an empty box during fade-out) and **never reset draft state in `useEffect([open])`**.
  - Keep `<Dialog open={open}>` + `<DialogContent>` in an outer shell, increment `sessionKey` on open transitions (`prevOpen` render guard), and render `<InnerBody key={sessionKey} />` unconditionally inside `<DialogContent>`.
  - When `<Dialog onOpenChange>` must block dismissal while saving, sync a `busyRef` via `useLayoutEffect` (with unmount reset) rather than passing an upward `onBusyChange` state callback.
- **Confirmation prompts:** Use `ConfirmDialog` (`@kalaido/primitives/kalaido`, supporting optional `trigger`, controlled `open`/`onOpenChange`, `variant`, and `busy`) instead of duplicating raw `AlertDialog` subtrees.
- **Focus & timer cleanup:**
  - For dialogs, pass `initialFocus={inputRef}` directly to `<DialogContent>`.
  - For conditionally mounted inline pickers (`ItemPicker`), focus `inputRef.current?.focus()` in a mount `useEffect` instead of HTML `autoFocus`.
  - Every timer or frame request in `useEffect` must be allocated at the top level of that effect (never inside a nested `setInterval` callback) and return its cleanup (`clearTimeout` / `clearInterval` / `cancelAnimationFrame`). For canvas animations, compute timed phase transitions from `performance.now()` inside the `requestAnimationFrame` loop.

## Interactive Rows & Cards (Stretched-Button Pattern)

- **Semantic HTML only:** Never use `<div role="button">`, `<span role="button">`, `<div onClick>`, or `<button>` nested inside `<button>`.
- **Stretched primary `<button>` + sibling secondary `<button>`s:** For any clickable row or card that also hosts secondary actions or links (`ListRow`, `ProjectionRow`, `DocumentCard`, `FragmentCard`, `StreamTimelineRow`):
  ```tsx
  <div
    className={cn(
      "group relative rounded-none ...",
      "has-[[data-row-primary]:focus-visible]:ring-2 has-[[data-row-primary]:focus-visible]:ring-inset has-[[data-row-primary]:focus-visible]:ring-ring/50",
    )}
  >
    <button
      type="button"
      data-row-primary
      onClick={onClick}
      className="... text-left outline-none after:absolute after:inset-0 after:content-['']"
    >
      {title}
    </button>
    {trailing && (
      <div className="relative z-10 pointer-events-none flex shrink-0 items-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        {trailing}
      </div>
    )}
  </div>
  ```
  - Wrap only the concise title/header inside the primary `<button>` so screen readers do not read metadata columns or multi-line body previews as the button label.
  - Use `pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto` on `relative z-10` slots (`trailing`, `footer`) so secondary buttons/links are clickable while non-interactive badges (`StatusPill`, `SourceList`) let clicks fall through to `after:inset-0`.
  - Use `group-focus-within:opacity-100` (not `group-focus-visible`) on hover/focus-revealed controls inside the `<div>` shell.
  - *Vitest/jsdom note:* jsdom has no CSS `::after` layout geometry — click `getByRole("button", { name: ... })` in tests, not the outer `<div>`.

## Module Hygiene, Decomposition & Client Rules

- **Component-only `.tsx` exports:** Non-type exports from `.tsx` files must be React components only (preserving Vite Fast Refresh). Unexport file-local helpers or place shared helpers/constants in `.ts` modules (for `@kalaido/primitives`, use `src/lib/*.ts` so `#lib/*` and `./lib/*` resolve with zero `package.json` changes).
- **Route definitions & cloud app shells:**
  - In `apps/desktop`, `src/features/*/pages/*.tsx` export only their page component (with `*.transitions.ts` co-located beside them); all `defineRoute(...)` declarations live centrally in `apps/desktop/src/routes/definitions.ts` (imported by `registry.ts`).
  - In `apps/mobile` and `apps/web`, keep `react-router-dom` strictly inside `src/app.tsx` using mapped `<Route key={r.path} path={r.path} Component={r.Component} />` (stays under `duplicate-jsx-subtree` thresholds), and put shared router-free cloud UI/state (`CloudErrorBoundary`, `cloud-root-scope`, cloud views) in `packages/react/*`.
- **Size, complexity & private co-location (`<= 300` LOC, `CC <= 15`, `Cog <= 15`):**
  - Extract pure branching, formatting, and state-derivation logic into plain `.ts` helpers first (non-hook `.ts` functions are exempt from `no-high-complexity-react-function` and directly unit-testable), and extract workflow handlers into local `use-*.ts` hooks before splitting JSX along real visual/domain seams.
  - Keep internal sub-components and helpers private (never widen public feature barrels). Inside `packages/react/components/`, place private extracted `.tsx` sub-components in subdirectories (`src/chat/`, `src/fragment-drawer/`), **never** top-level `src/*.tsx` (`packages/react/components/package.json` maps `"./*": "./src/*.tsx"` as public exports).
- **PocketBase concurrent reads (`requestKey: null`):** All Kalaido PocketBase clients run with `autoCancellation = true` (keyed by `METHOD + path`, ignoring query params). Any concurrent `Promise.all` calls to `.getList` / `.getFullList` on the same collection must pass `{ requestKey: null }` or earlier requests will self-abort.
- **Stable non-index React keys:** Never embed raw array index in `key`. Use backend IDs or canonical domain tuples; when backend items can share identical tuples (e.g. `llm_queue_status.running` tasks admitted in the same `dispatchLocked()` tick sharing identical `started` timestamps), disambiguate with a per-tuple occurrence counter (`Map<string, number>`).
