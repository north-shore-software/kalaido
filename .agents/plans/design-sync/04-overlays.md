# 04 — Reskin the overlay family

**Rules being applied:** §5 Shadows: "Popovers and dialogs do **not** get
[accent shadows] — they sit on `bg-2` with a `line` border." Plus: depth is
surface, never shadow (§1/§3); §5 Motion sanctions their entrance animations
(zoom/slide, 100–350ms) — keep those; §2 `overlay-title` role.

## Changes

In `app/src/components/ui/`, for every overlay actually used by the app —
`dialog.tsx`, `alert-dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`,
`select.tsx`, `context-menu.tsx`, `menubar.tsx`, `hover-card.tsx`,
`combobox.tsx`, `sheet.tsx`:

1. Remove `shadow-md` / `shadow-sm` and `ring-1 ring-foreground/10`.
2. Give each a `border border-line` on `bg-popover` (which already = `bg-2`).
3. Keep the enter/exit animations (sanctioned by §5 Motion). Exception:
   `navigation-menu.tsx` uses a foreign easing and 350ms — normalise to the
   system curve if it's ever used; it currently has no call sites, so it can
   also just be left for step 17's dead-code sweep.
4. Overlay titles: they already use `font-heading text-lg font-semibold
   uppercase`; change `tracking-wider` → `tracking-[0.08em]` per §2
   `overlay-title` (20px / 600 / 0.08em).
5. Inner content of dialogs still on shadcn defaults (`text-sm`, `gap-6 p-6`):
   move text to §2 roles (`text-body-sm` etc.); spacing may stay if it looks
   right — Sara judges.

## Review screen

Any dialog-heavy flow: the **context picker dialog** (from a projection draft)
and the **delete confirmation** in Settings › Danger Zone. Open each overlay
type that ships: dialog, alert-dialog, popover, dropdown, select, sheet
(Chat's context sheet).

Compile check: `npx tsc --noEmit` in `app/`.
