---
title: "Hand-edit fragment flag re-parses the whole environment on every edit"
status: "open"
author: "agent"
created: "2026-09-25"
---

## Description
`projections.shouldCreateFragment` reads the app-store key only when the flag was true at boot; otherwise it falls through to `config.HandEditCreateFragment()`, which calls `LoadEnv()` and re-parses every `KALAIDO_*` variable per hand edit. A parse error there is swallowed as `false`, although the same error is fatal at boot. The legacy alias `KALAIDO_CREATE_EDIT_FRAGMENTS` is consulted silently and documented nowhere. The old lenient `config.flag` helper is now dead code (only its test calls it).

## Steps to Reproduce
1. Boot without `KALAIDO_HAND_EDIT_CREATE_FRAGMENT`.
2. Hand-edit a candidate and trace `config.LoadEnv` calls.

## Expected Behavior
The flag is resolved once at boot (store both values), or the fallback reads one variable, not the whole environment.

## Observed Behavior
One full environment parse per edit request; alias and dead helper left behind.
