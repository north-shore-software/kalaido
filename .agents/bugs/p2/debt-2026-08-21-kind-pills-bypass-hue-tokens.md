---
title: "Dashboard and rotation kind pills hand-roll green/violet with raw alpha classes instead of the hue tokens"
status: "open"
author: "agent"
created: "2026-08-21"
---

## Description
`app/src/features/dashboard/components/pin-card.tsx` and
`app/src/features/rotation/components/active-rotation-card.tsx` each render the
PROJ / REFL kind label by overriding `StatusPill` with
`border-green/45 bg-green/10 text-green` (and the violet equivalent). Those are
ad-hoc alphas, not the `-edge` / `-wash` / `-ink` tiers DESIGN.md §3–4 define and
`index.css` exposes (`border-green-edge bg-green-wash text-green-ink`). The values
currently coincide (0.45 / 0.08 ≈ 0.10) but will drift the moment a token is tuned.

`app/src/components/kalaido/kind-pill.tsx` (`KindPill`, added for the projections
index) renders the same label from the tokens. Both call sites should adopt it.

## Expected Behavior
One kind-pill recipe, driven by the hue tokens.

## Observed Behavior
Three renderings of the same pill; two bypass the tokens.

## Context / Relevant Code
- `app/src/features/dashboard/components/pin-card.tsx`
- `app/src/features/rotation/components/active-rotation-card.tsx`
- `app/src/components/kalaido/kind-pill.tsx`
