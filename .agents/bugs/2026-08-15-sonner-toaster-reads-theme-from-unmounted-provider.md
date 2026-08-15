---
title: "Sonner Toaster reads its theme from next-themes, which is never mounted"
status: "open"
author: "claude"
created: "2026-08-15"
---

## Summary
`components/ui/sonner.tsx` imports `useTheme` from `next-themes`, but the app uses a
hand-rolled `ThemeProvider` and mounts no `next-themes` provider. Toasts always resolve to
the destructured default, `"system"`, and ignore the in-app setting.

## Description
`app/src/components/ui/sonner.tsx:1` is stock shadcn scaffolding that was never rewired:

```ts
import { useTheme } from "next-themes";
...
const { theme = "system" } = useTheme();
```

The app's real theme context is `app/src/providers/theme-provider.tsx`, exported as
`useTheme` from that module. With no `next-themes` `ThemeProvider` in the tree, the hook
returns an empty object and the `= "system"` default always applies.

`next-themes@^0.4.6` is a direct dependency carried solely for this dead import.

## Steps to Reproduce
1. Set the app theme to **Light** (Settings › Appearance).
2. Trigger any toast.

## Expected Behavior
The toast is styled for the active app theme.

## Observed Behavior
The toast is styled for the OS preference, which may not match the app.

## Context / Relevant Code
- `app/src/components/ui/sonner.tsx:1,11`
- `app/src/providers/theme-provider.tsx:26-28` (the real `useTheme`)
- `app/package.json` — `next-themes` dependency

## Notes
Fix is to import `useTheme` from `@/providers/theme-provider` and drop the `next-themes`
dependency. Whether the app should ship a light theme at all is a separate open question —
see the design-system work, which hides the theme UI while leaving the mechanics wired.
