# 02 — Section-accent tokens and primitive re-pointing

**Rules being applied:** §3 "In code the section accent is a semantic token set
per route — `--section` plus its `-wash` / `-edge` / `-veil` / `-fg` tiers";
§4 (the whole accent model: section accent = position/state; rail is the colour
legend; Capture tints with the current section; `::selection` and the focus ring
follow the section accent).

## Changes

1. **Tokens** (`app/src/index.css`):
   - Define `--section`, `--section-wash`, `--section-edge`, `--section-veil`,
     `--section-fg` (= `#16171a`), `--section-ink` (= `--section`). Default
     values = brand cyan tiers (covers pre-workspace and anything unmapped).
   - Per-section overrides via `[data-section="chat"]`, `[data-section="projections"]`,
     etc., using the hues finalised in step 01 (wash 0.12–0.14, edge 0.40–0.45,
     veil 0.04–0.05 of the hue). Neutral sections (connections, settings) map the
     tiers onto `fg-2`-based greys.
   - Expose Tailwind utilities in `@theme inline`: `--color-section`,
     `--color-section-wash/-edge/-veil/-foreground/-ink`, and a
     `--drop-shadow-section: 4px 4px 0 <section at 0.28>` if feasible (if a
     var-based drop-shadow doesn't work, keep `shadow-cyan` usage per-section by
     hand and note it).
   - Move `--status-drifting` to the step-01 value. `::selection` background →
     `var(--section)`. `--ring` → `var(--section)`.
2. **Route wiring**: set `data-section` on the app shell per route (the route
   registry / `PageLayout` is the right place — one attribute, driven by the
   route id). Sub-routes inherit: rotation → projections, import → connections.
3. **Re-point the primitives** from hard-coded cyan to section tokens:
   - `components/ui/sidebar.tsx` — active item `border-l-cyan` / `text-cyan-ink`
     → section. **Rail legend (§4):** each rail item's active border should use
     its own destination's hue, not the current page's — pass the destination
     section's colour per item (`components/layout/sidebar-nav.tsx`).
   - `components/layout/nav-sidebar.tsx` — Capture's `ACTION_CLASS` cyan →
     section tokens (it then tints with wherever you are). Delete the stale
     comment that redefines cyan as "this makes something" (§4 supersedes it).
   - `components/kalaido/pill.tsx` — `primary` tone cyan → section.
   - `components/kalaido/refine-composer.tsx` — armed send button `bg-cyan` →
     `bg-section`, glyph `text-section-foreground`.
   - `features/settings/pages/Settings.tsx` — active nav cyan → section
     (settings is neutral, so this becomes the grey treatment; Danger Zone keeps
     `critical`).
   - `features/settings/components/kalaidoscope-row.tsx` — hero card
     `border-cyan-edge bg-cyan-veil shadow-cyan` → section equivalents.
   - Leave `StatusPill`'s explicit `cyan`/`magenta` kinds alone — status and
     demand are global (§4).

## Review screen

**Dashboard** (should look unchanged — dashboard is cyan), then Sara flips
through Chat / Projections / Reflections to see the hue walk. Also check: rail
active borders show each destination's own colour; text selection and focus
rings follow the page; settings goes monochrome.

Compile check: `npx tsc --noEmit` in `app/`.
