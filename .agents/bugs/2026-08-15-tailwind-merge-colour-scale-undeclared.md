---
title: "className cannot reliably override a component's colour — tailwind-merge has no colour scale declared"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Description
`cn()` in `src/lib/css-utils.ts` now extends tailwind-merge with the custom `--text-*`,
`--shadow-*` and `--drop-shadow-*` scales, but **not** the custom colour scale.

tailwind-merge v3 resolves its `text-color` / `bg-color` / `border-color` groups from
`theme.color`, which is empty by default. None of the app's colour tokens (`fg-1..5`,
`surface-0..3`, `line`, `line-strong`, `cyan`, `magenta`, `yellow`, `*-ink`, `*-wash`,
`*-edge`, `*-veil`, `stable`, `drifting`, `critical`, `content-1..8`, and the shadcn
aliases) are known to it. Two colour utilities on the same property therefore land in no
conflict group at all, and **both survive the merge**. Which one paints is decided by the
order Tailwind happens to emit them inside `@layer utilities`, not by author intent.

This is the same root cause as the font-size collision fixed on 2026-08-15, but the
opposite failure mode: there, one class was wrongly dropped; here, neither is.

## Steps to Reproduce
1. `<Button variant="ghost" size="xs" className="text-fg-3">` — the `ghost` variant
   contributes `text-fg-2`.
2. Inspect the rendered element.
3. Both `text-fg-2` and `text-fg-3` are present in `class`.

## Expected Behavior
`className` is the last word. `text-fg-3` should replace the variant's `text-fg-2`,
the same way `text-btn-sm` correctly replaces `text-btn`.

## Observed Behavior
Both classes are emitted. The winner depends on Tailwind's internal utility ordering, so
overriding a component's colour from a call site is unreliable and can silently flip when
an unrelated utility is added or removed elsewhere in the app.

## Context / Relevant Code
- `src/lib/css-utils.ts` — `extendTailwindMerge` currently declares `theme.text`,
  `theme.shadow` and `theme["drop-shadow"]` only.
- `src/index.css` `@theme inline` — the full list of `--color-*` keys that would need to
  be mirrored into `theme.color`.
- Live call sites today (both Ladle stories, so no user-visible breakage yet):
  - `src/components/kalaido/chat-messages.stories.tsx:34` — `text-fg-3` over `text-fg-2`
  - `src/components/kalaido/text.stories.tsx:9` — `text-cyan-ink` over `text-fg-3`
- Fix is mechanical but wide: enumerate the colour token names into `theme.color`. The
  list must then be kept in step with `@theme inline`, which is why it was not folded
  into the font-size fix.
