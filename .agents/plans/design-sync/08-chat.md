# 08 — Chat

Screen: `features/chat/pages/Chat.tsx`, `components/conversation-list.tsx`,
`components/kalaido/chat-panel.tsx`.

This is the yellow section's showcase — the first screen where the section-hue
model is loudly visible. Give Sara time on it.

## Changes

1. **Conversation list rows** (`conversation-list.tsx`): currently shadcn
   semantics (`hover:bg-accent`, `bg-accent` selected, `border-primary` active
   edge, `text-sm`/`text-xs`). Rule: §7 List rows (plain-row variant: borderless,
   selection `bg-2`, hover `bg-2` at half alpha, title `row` 500→600 selected,
   metadata `mono-sm` `fg-4`) + §4 (active edge in the section accent →
   `border-section`, i.e. yellow here). Restyle to the recipe.
2. **Composer**: verify step 05 landed here — armed send = solid yellow, dark
   glyph, chamfered.
3. **Type pass**: replace the remaining t-shirt sizes with §2 roles (map in
   README).
4. **Context sheet** (`Chat.tsx` uses `sheet.tsx`, `w-80`): verify the step-04
   overlay reskin took; width is fine per §6's per-content context panels.

## Review

Chat with a few conversations: selection and hover in the list, the yellow
armed send button, focus ring and text selection in yellow. Sara should
explicitly confirm the amount of yellow feels right — if she wants it dialled
up or down, that's tuning the *recipes* (§3 tier alphas), a rule conversation.
Compile check: `npx tsc --noEmit` in `app/`.
