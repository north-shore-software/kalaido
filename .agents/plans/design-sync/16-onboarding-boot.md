# 16 — Onboarding + boot (pre-workspace)

Screens: `features/onboarding/pages/{OnboardingLanding,OnboardingLogin,CloudWorkspaces}.tsx`,
`features/create-kalaidoscope/pages/KalaidoscopeSetup.tsx`,
`features/boot/**`. These wear **brand cyan** (§3 map) and own the glow (§5).

**Sara designed OnboardingLanding herself (commit a322c0bf) — it is the
reference for this step. Preserve its look exactly; only substitute equivalent
tokens.**

## Changes

1. **Type migration without visual change** (§2 roles): these pages are ~50
   t-shirt uses. Map each to the role with the same rendered size where one
   exists (`text-sm`→`body-sm`-ish, etc. — README map). The hero titles
   (`text-2xl`/`text-xl` Archivo semibold) are a documented §2 exception —
   **keep their look**; if the legacy tokens they use are to be deleted in step
   17, re-express the same sizes explicitly and note them in §7's choice-cards /
   pre-workspace section so they're rule-backed.
2. **KalaidoscopeSetup double heading** (§2: one title per screen): it still
   has two `text-lg font-semibold` headings (an `h2` ~line 218 and an `h1`
   ~line 251). Demote one to a `card-title` or `label` — Sara picks.
3. **Boot/recovery screens**: same type migration; the recovery screen's title
   follows the pre-workspace hero exception.
4. **Choice cards**: already per §7 (Sara's work). Verify nothing from earlier
   steps (buttons, icons stroke) accidentally changed their look — the glow and
   arrow slide are sanctioned here (§5).
5. `storage-option-cards.tsx` hover (fill + border) is legal under §5's
   clickable-card rule — keep.

## Review

Full onboarding walk: landing (glow, cards), login, cloud workspaces, setup,
plus the boot error screen (trigger or story). Pixel-compare landing against
Sara's version — it must not have drifted.
Compile check: `npx tsc --noEmit` in `app/`.
