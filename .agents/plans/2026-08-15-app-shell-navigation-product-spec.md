---
title: "App shell: navigation and page chrome — product spec"
status: "implemented"
author: "claude"
created: "2026-08-15"
---

**Scope**: this is slice 1 of the product spec derived from the `louis/ui-tweaks` prototype. It covers the **persistent shell** — the left sidebar, the page header, and the utility bar. It does *not* cover the Manage Kalaidoscopes settings page, which is the other half of that branch and gets its own spec (§9).

**Status of the source**: the prototype is clickable-standard code. It is treated here as a statement of *intent*, not as an implementation to preserve. Where it hid something behind `className="hidden"`, left an action as a `toast.info`, or leaned on a default that happens to work, this spec says what the product should actually do instead. Decisions the prototype made implicitly are made explicit in §7; the ones it dodged are in §8.

## Context

The shell before the prototype grouped navigation by *read vs write*: a Dashboard link on top, then an accented "actions" cluster (Chat, Add Note) that created things, then workspace sections, then Connections. The utility bar along the bottom carried the workspace location, sidecar status, inference rate, and a theme toggle.

The prototype rearranges this around a different question — not *what kind of thing is this control*, but *how often do you reach for it*. Capture is promoted above everything; Chat demotes from an "action" to ordinary navigation; Settings gains a permanent home; the sidebar collapses to icons by default and the utility bar sheds most of its contents.

That reordering is the product change. The rest of this spec is what it commits us to.

## 1. What the shell is for

Three jobs, in priority order:

1. **Get a thought out of the user's head and into the workspace.** Capture is the only thing in the shell that creates data, and it is reachable from every page without a navigation step.
2. **Move between the workspace's views.** Dashboard, Chat, and the four entity sections.
3. **Stay out of the way.** The shell is not the product; the page is. This is the justification for the collapsed default and the stripped utility bar, and it is the tiebreaker whenever a new control wants shell real estate.

Anything that fails all three belongs in Settings, not the shell.

## 2. Sidebar information architecture

Four zones, top to bottom, separated by rules:

| Zone | Contents | Rationale |
|---|---|---|
| **Header** | Kalaidoscope switcher | Which workspace am I in — the frame for everything below |
| **Capture** | Capture (opens the capture modal) | The one write action; alone in its zone so it cannot be mistaken for navigation |
| **Primary** | Dashboard, Chat | The two "where do I start" destinations |
| **Workspace** | Projections, Reflections, Colours, Fragments | The entity sections — browsing, not starting |
| **Footer** | Settings | Infrequent, and conventionally bottom-left |

Capture keeps the accent treatment; everything else is neutral. The accent now means exactly one thing — *this creates something* — where before it was shared with Chat and meant something vaguer.

**Chat's demotion is a claim about what Chat is.** In the old grouping it sat with Add Note because a conversation produces data. Putting it beside Dashboard says the opposite: Chat is a *place you go and return to*, like a view, not a one-shot action. If that's wrong, Chat belongs back beside Capture, and this is the cheapest decision on the branch to revisit.

**Capture's rename is unfinished.** The label changed from "Add Note" to "Capture" but the control still opens the add-*fragment* modal, and the workspace section is still called "Fragments". Either the user-facing noun for the raw input is "fragment" and the verb is "capture", or the rename should carry through the modal and the section. Pick one before build; a shell verb that doesn't match the noun on the destination page is the kind of inconsistency that never gets cleaned up later.

## 3. Collapsed by default

The sidebar now starts icon-only and the collapse toggle is hidden. This is the most consequential change in the branch and the prototype does not fully commit to it.

What the prototype actually produces: the sidebar opens collapsed **every launch**. `SidebarProvider` writes a `sidebar_state` cookie when the state changes but nothing ever reads it — a leftover from the component's server-rendered origin, harmless when the default was `true` and load-bearing now that it's `false`. Meanwhile `Cmd/Ctrl+B` still toggles, so the state *is* user-changeable, just not discoverably and not durably.

The product needs to choose one of three, and they are genuinely different products:

- **A — Permanently icon-only.** The expanded state is dead. Remove the toggle, the shortcut, and the width machinery; design the rail for icons only. Simplest, and honest about what the prototype looks like in use.
- **B — Collapsed by default, expandable and remembered.** Restore a visible affordance, and make the state persist across launches. The cookie becomes a read as well as a write, or moves to the same store as other UI preferences.
- **C — Collapsed by default, expandable, not remembered.** What the prototype does, minus the hidden button. Hard to justify: it deliberately forgets a choice the user just made.

**Recommendation: B.** Icon-only is right for the steady state — the labels are learned within a session — but a first-run user faces seven unlabelled icons, and hover tooltips are not a discovery mechanism for someone who doesn't yet know there's anything to hover. B keeps the calm default and leaves a way out. A is defensible if we pair it with something else that teaches the icons; C should not ship.

Whichever wins, the keyboard shortcut and the visible affordance must agree. Today one exists without the other.

### Tooltips are now the label

With the sidebar collapsed, the tooltip *is* the item's name — it is not decoration. The prototype tightened this correctly: tooltips render only in the collapsed state rather than rendering-then-hiding, they get a small open delay and offset, and the kalaidoscope switcher gained a tooltip showing the active workspace's display name because in icon mode it is otherwise an unlabelled mark.

Consequences the build has to honour: **every** shell control needs a tooltip, its text must match the expanded label exactly, and the tooltip must be reachable by keyboard focus, not hover alone. Icons also grew (`size-5`, heavier stroke) — correct, since at icon width the glyph carries the entire meaning.

## 4. The page header roots at the active workspace

The breadcrumb trail now always begins with the **active kalaidoscope's display name**, replacing a literal `"Kalaidoscope"` root where a page supplied one and prepending it where a page supplied none.

This is the compensation for the switcher shrinking to an icon: at any moment the page itself tells you which workspace you are looking at, so a mis-scoped read is harder to make. That makes it a correctness feature, not a decorative one, and it should be specified as such: **no page in a workspace scope renders without the workspace name in its trail.**

Two things the prototype leaves loose:

- The fallback string when no active workspace resolves is the literal `"Kalaidoscope"`. That's a placeholder pretending to be a name. Decide what the header shows when the app is not in a workspace scope — most likely: no trail at all, since a scope-less page has nothing to root.
- The substitution is a string comparison against `"Kalaidoscope"`, so it only works while every page happens to use that exact word. Pages should declare a trail *relative to* the workspace root and let the header supply the root, rather than each page naming a root the header then tries to detect and rewrite.

## 5. The utility bar loses two things

The bar keeps sidecar status and the inference rate, and right-aligns them. It loses the location label and the theme toggle.

**The location label is a move, not a deletion.** The workspace locator becomes visible on the Manage Kalaidoscopes page (slice 2) instead. That's the right trade — a filesystem path or API URL is reference information you look up occasionally, not a permanent fixture — but it means the two slices are coupled: **the location label cannot be removed before its replacement exists.** Sequence the build accordingly.

**The theme toggle is a deletion, and it is a regression.** After this branch, `ThemeToggle` is referenced only from a Storybook story. There is no way to change theme anywhere in the running app, and Settings' Appearance section is an unimplemented placeholder. The shell was the only home theme had.

Removing it from the bar is defensible — the bar should be status, not controls. Removing the capability is not. **The build must give theme a home in Settings before or with this change**; the simplest form is a real Appearance section with a light / dark / system control. Flagging rather than deciding: whether Appearance is worth building now or whether the toggle stays in the bar until it is, is a scheduling call.

## 6. Hidden is not a decision

The prototype hides three things with `className="hidden"`: the Connections nav group and its separator, and the collapse toggle. Nothing is removed, so:

- The `/connections` route is still registered and still reachable by URL and by any other link into it. A feature that is "not ready" is currently unadvertised, not unavailable.
- The dead markup renders on every page and will drift out of sync with whatever changes around it.

For the build, each needs an explicit outcome: **ship it, remove it, or gate it behind a real flag** that also controls routability. `hidden` is a prototyping shortcut and should not survive into the implementation. The collapse toggle's outcome falls out of §3.

## 7. Decisions this spec makes

1. Capture is the shell's only write action, sits alone above navigation, and keeps sole use of the accent treatment.
2. Chat is navigation, not an action, and sits beside Dashboard.
3. Settings is a permanent footer destination with its own route transition.
4. The sidebar defaults to icon-only; the expanded state's fate is §3, recommendation **B**.
5. Tooltips are the collapsed-state label: mandatory on every control, matching the expanded text, keyboard-reachable.
6. Every in-workspace page header is rooted at the active workspace's display name, supplied by the header rather than by each page.
7. The utility bar is status-only: sidecar state and inference rate, no controls, no locator.
8. Nothing ships hidden by CSS.

## 8. Questions, and how they were answered

These were open when the spec was written. They were settled during the build rather than before it, so each is recorded here with the call that was made — all six are reversible, and the reasoning is here to argue with.

1. **Sidebar persistence** — **B.** Collapsed default, a visible toggle in the footer, state persisted. Persistence moved from the never-read cookie to `localStorage`, read on init. `Cmd/Ctrl+B` and the button now agree.
2. **Capture vs Fragment vocabulary** — **verb/noun split, no further renames.** "Capture" is the action, "Fragment" is the thing; the modal's "New Fragment" title and the Fragments section already read correctly against it. Revisit only if "fragment" itself is the wrong noun.
3. **Theme's new home** — **built now**, as Settings › Appearance, because the alternative was shipping a regression. This turned out larger than the spec implied: `persistTheme` was an empty function and `getInitialTheme` always returned `"light"`, so theme had never persisted at all. Appearance now offers light / dark / **match system**, defaults to system, persists the *choice* rather than the resolved value, and follows the OS while the app is open.
4. **Connections** — **flagged.** `lib/feature-flags.ts` plus a `featureFlag` field on `RouteDef` enforced in the route gatekeeper, so the flag withholds the destination as well as the link.
5. **Scope-less header** — **the page's own trail stands alone**, with no root prepended. No literal placeholder name is ever shown.
6. **First-run discoverability** — moot under B: the toggle is visible, so the labels are one click away.

## 9. Deferred slices

Named here so the shape of the whole is visible; not built.

- **Slice 2 — Manage Kalaidoscopes page.** Active-scope panel, local/cloud grouping, per-row actions (switch, backup, delete), and Settings section ordering. Depends on this slice for the Settings entry point, and owes it the relocated locator — **the utility bar still shows the locator** and cannot stop until this page shows it instead (§5).
- **Slice 3 — Provider identity.** The prototype adds a `provider` field (`ollama` / `gemini` / `api`) and a badge that only renders two of the three states. What a provider *is* at the workspace level, where it is set, and how it is displayed — this is a data-model question wearing a badge, and it overlaps the existing BYOK plan.
- **Slice 4 — Implementation plan.** Build sequence and step breakdown, once slices 1–3 are agreed and the §8 questions are closed.
