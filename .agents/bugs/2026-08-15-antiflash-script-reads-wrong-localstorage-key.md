---
title: "Anti-flash theme script reads a localStorage key nothing writes"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
The inline anti-flash script in `index.html` reads `kalaido-theme`, but `theme.ts` persists
to `theme`. The script therefore never sees the user's choice and always falls through to
its hardcoded `'dark'` default.

## Description
Two layers decide the pre-paint theme and they disagree on both the storage key and the
default:

- `app/index.html:9` — `localStorage.getItem('kalaido-theme') || 'dark'`
- `app/src/lib/theme.ts:9` — `const THEME_STORAGE_KEY = "theme";` (read at :34, written at :46)
- `app/src/lib/theme.ts:41` — default when nothing is stored is `"system"`, not `"dark"`

Because `kalaido-theme` is never written, the first branch is dead code. Every launch adds
`.dark` before React mounts, and `ThemeProvider` then re-resolves the real choice on first
render.

## Steps to Reproduce
1. Open Settings › Appearance and choose **Light**.
2. Confirm `localStorage.theme === "light"` and `localStorage['kalaido-theme']` is `undefined`.
3. Restart the app.

## Expected Behavior
The window paints in the user's chosen theme with no flash.

## Observed Behavior
The window paints dark, then snaps to light once `ThemeProvider` runs.

## Context / Relevant Code
- `app/index.html:7-12`
- `app/src/lib/theme.ts:9,34,41,46`
- `app/src/providers/theme-provider.tsx:31-35` (applies theme in the `useState` initializer)

## Notes
Currently masked: dark is the only theme the product ships, so the wrong default happens to
be the right answer. It will surface the moment a second theme is enabled. Fixing it is a
one-word change in `index.html`, but the *default* mismatch (`dark` vs `system`) is a
product decision, not a typo.
