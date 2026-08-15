---
title: "Rail attention marker — magenta Dashboard icon when something needs a decision"
status: "draft"
author: "claude"
created: "2026-08-15"
---

**Scope**: give the icon rail a second, content-driven signal. The Dashboard icon turns
magenta while the workspace holds items awaiting the user's decision. One hook, one prop,
two call sites. No new tokens, no layout change.

## Context

`DESIGN.md` §4 reserves magenta for "your decision is required" and cyan for system state.
Slice 4 of the design-system migration therefore made the rail's active marker **cyan** — a
2px `border-left` meaning *you are here* — and deliberately did not use magenta, because the
shell cannot know whether a decision is pending. That left the plan's original "magenta
active rail item on a review screen" unimplemented, and correctly so: it was conflating two
different signals onto one channel.

This is the missing half. Position is cyan and structural; attention is magenta and
content-driven. They are independent, and an item can carry both at once.

The Dashboard is the right carrier because it already *is* the attention surface — its
"Needs action" section is the list of exactly these items (`needs-action-section.tsx`,
rendered from `Main.tsx:144`).

## The signal

`Main.tsx:146` derives the count as `statuses.filter(hasDelta)`, from `useRotationStatus()`.
`Rotation.tsx:62` computes the identical expression. Both are page-local, so the rail — which
lives above the route in `NavSidebar` — cannot see it.

Lift it into one hook and let all three read it. This removes an existing duplication rather
than adding a third copy.

```
src/hooks/use-needs-attention.ts
  export function useNeedsAttention(): { count: number; loading: boolean }
```

Wrapping `useRotationStatus()` and applying the existing pure `hasDelta` predicate from
`api/kalaidoscope/rotation.ts`. No new fetching — `useRotationStatus` is already mounted
app-wide by the rail's own render.

## The mark

`SidebarNavItem` grows one optional field:

```ts
attention?: boolean;   // "a decision is waiting behind this item"
```

`SidebarNav` passes it to `SidebarMenuButton` as a `data-attention` attribute; the cva base
gains one rule:

```
data-[attention=true]:*:[svg]:text-magenta-ink
```

The **icon only**. Not the label, not the border, not a fill. Rationale:

- the 2px `border-left` is already spoken for by position (cyan), and overloading it would
  make "where I am" and "what needs me" indistinguishable
- collapsed is the default rail state, where the icon *is* the item — so the icon is the one
  channel that reads in both states
- it satisfies §4's "a screen with nothing awaiting the user contains no magenta at all":
  when `count === 0` nothing is marked, and the mark disappears the moment the queue drains

An active Dashboard with pending work therefore shows a cyan left border **and** a magenta
icon. That reads correctly: you are here, and there is something here for you.

## Open question for review

Whether to also mark **Projections** and **Reflections** when their own subtrees hold
pending items. Arguments both ways:

- *For*: the deltas are per-entity; `hasDelta` already knows the `type`, so splitting the
  count by kind is nearly free, and it tells the user which section to go to.
- *Against*: it multiplies magenta across the rail and dilutes it. §4 is emphatic that
  magenta is scarce. The Dashboard already aggregates everything, so one mark may be the
  honest total.

Recommendation: **Dashboard only** to start. It is the smaller change, it keeps magenta
scarce, and adding the per-section marks later is additive — the hook would just return a
breakdown instead of a count.

## Slices

1. `use-needs-attention.ts` + repoint `Main.tsx` and `Rotation.tsx` at it. Pure refactor,
   no visual change, verifiable by both screens looking identical.
2. `attention` on `SidebarNavItem`, `data-attention` in `SidebarNav`, the cva rule in
   `sidebar.tsx`, and `MAIN_NAV`'s Dashboard entry wired to the hook.

## Verification

- `npx tsc --noEmit`, `check-navigation-discipline` — in-container.
- `./kalaido.sh check:all` on the Mac.
- Ladle: `layout/sidebar-nav.stories.tsx` gains a marked-item story.
- By hand: a workspace with a pending snapshot shows the magenta Dashboard icon; approving
  the last one clears it without a reload. Check it collapsed *and* expanded, and check it
  while the Dashboard itself is the active item.
