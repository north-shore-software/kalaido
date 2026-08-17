# 15 — Settings

Screen: `features/settings/pages/Settings.tsx` + `features/settings/components/*`.
Section accent: **neutral**. The Manage Kalaidoscopes section is a mock screen —
reference quality; change it least.

## Changes

1. **Page title** (§2: "exactly one page title per screen, in `display`").
   Settings currently has none. Add a serif `display` "Settings" heading at the
   top of the main pane (above the section content, inside the 1000px column).
   Show Sara — if she prefers the title-less layout, that's an §2 exception to
   record (README loop step 4).
2. **Theme toggle** (`components/layout/theme-toggle.tsx`): selected segment
   uses `bg-background + shadow-xs`. Rule: §7 segmented control — selected
   segment is the near-white `fg-2` fill, as `components/kalaido/segmented.tsx`
   already does. Restyle to match (or swap in the `Segmented` component). Note
   this control is on the hidden Appearance section (§9) — review via direct
   navigation to `/settings/appearance`.
3. **Active nav**: neutral section — active item becomes the grey treatment from
   step 02; Danger Zone keeps `critical` (§6). Verify.
4. **Type pass**: ~16 t-shirt sizes across the section components → §2 roles.
5. OAuth buttons keep the `secondary` variant (§7 sanctions exactly that use).

## Review

Settings nav + Manage Kalaidoscopes (must still match the mock) + Danger Zone +
`/settings/appearance` for the segmented control.
Compile check: `npx tsc --noEmit` in `app/`.
