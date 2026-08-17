# 05 — One chat composer

**Rule being applied:** §7 Inputs: "A chat composer is a `line`-topped bar,
12px/16px padding, with a 26px chamfered send button that is
`line-strong`/transparent/`fg-4` when idle and solid cyan [read: section accent,
per §4] with `#16171a` glyph once armed."

## Context

Two implementations exist. `components/kalaido/refine-composer.tsx` matches §7
exactly. `components/kalaido/chat-composer.tsx` — the one `ChatPanel` (and
therefore the actual Chat screen) uses — is a plain 28px icon button: no
chamfer, no armed state, 16px padding, colourless top border.

## Changes

1. Make `chat-composer.tsx` match the §7 recipe — either by reusing the send
   button + bar styling from `refine-composer.tsx` (extract a shared piece if
   that's clean), or by restyling in place: `border-t border-line`, `px-4 py-3`,
   26px `clip-chamfer` send button, idle `border-line-strong` transparent
   `text-fg-4`, armed `bg-section text-section-foreground`.
2. Keep chat-composer's extra behaviour (quota notice, disabled states). The
   quota notice currently uses `border-destructive/40 bg-destructive/5` — per §4
   danger is destructive-only; a quota warning is a **drifting** state. Switch
   to `drifting` wash/ink.
3. On Chat (yellow section), armed = solid yellow with dark glyph — that is the
   §3 recipe working as intended; flag it to Sara explicitly since it's the
   boldest new colour moment.

## Review screen

**Chat.** Type a message; watch the send button arm. Also check the refine
composer on **Projection Review** still looks identical to before (violet
armed state now, per its section).

Compile check: `npx tsc --noEmit` in `app/`.
