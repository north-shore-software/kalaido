# 17 — Context UI (context-bar, mentions, quota notice)

Scope: the context-selection and @-mention UI that landed on main (#53, #54,
#56) **after** this sweep started, so no earlier step covers it:
`components/kalaido/context-bar/context-bar.tsx`, `mention-menu.tsx`,
`context-picker/item-picker.tsx`, and the mention chips + quota notice in
`chat-messages.tsx` / `chat-composer.tsx`.

It renders on four screens across three section hues — review on all of them:
**Chat** (yellow), **NewProjection** and **ProjectionReview** (green),
**NewReflection** (violet).

## Changes

1. **Mention menu shadow** (`mention-menu.tsx` ~line 103): drop `shadow-md`.
   Rule: §5 — overlays are `border-line`-drawn; they carry no shadow or ring.
2. **Chat message type roles** (`chat-messages.tsx`): four `text-sm` uses →
   §2 roles (message bodies read as `body-sm`). Same file: the inline mention
   chip (~line 42) is `rounded-sm` — §5 zero-radius says `rounded-none`. If
   Sara prefers the softened chip, record it as a §5 exception (README loop
   step 4), don't leave it silent.
3. **Quota notice tone** (`chat-composer.tsx` ~line 116) — step 05's open
   item, closed here: `border-destructive/40 bg-destructive/5` → `drifting`
   wash/ink (§4: danger is destructive-only; a quota warning is "true, but
   getting less true"). Its `rounded-md` and `text-xs` migrate at the same
   time.
4. **Review the ported section tints.** In round 2, Sara's
   abolish-yellow-source-tint work was re-applied onto these components —
   which she has never seen rendered: the three pickers and the pin chips in
   `context-bar.tsx` wear the route's section accent, and `item-picker.tsx`'s
   tint model is `section | magenta`. Nothing to change up front; Sara
   eyeballs all four host screens (the picker goes yellow on Chat, green on
   the projection screens, violet on NewReflection) and any adjustment goes
   through the normal loop.

## Review

All four screens above: open each picker, add/remove a pin, trigger an
@-mention, and (on Chat) view a quota warning if reproducible — otherwise
verify its classes by inspection. Compile check: `npx tsc --noEmit` in `app/`.
