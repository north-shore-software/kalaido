---
title: "Explicit provider config writing and mutable provider selection"
status: "done"
author: "human"
created: "2026-08-14"
---

## Summary
Currently, selecting "Local Ollama" writes no configuration because `provider_immutable` in `config/hooks.go` locks the provider for the workspace's lifetime once set. To fix this sub-optimal behavior, provider selections (including Ollama) should be written explicitly to config, and users/workspaces should be allowed to change providers later.

## Motivation / Use Case
Leaving Ollama unwritten to avoid locking the workspace into Ollama means the selection acts as a label rather than actual saved state. Writing provider selections explicitly while allowing providers to be changed later removes this workaround and gives users full provider flexibility.

## Proposed Concept
- Write provider selections explicitly to configuration (e.g. `provider: "ollama"`).
- Remove or update the workspace `provider_immutable` restriction (`config/hooks.go`) to allow changing the LLM provider over the workspace's lifetime.

## Open Questions
- None raised by user.

## Resolution (2026-08-18)
Provider mutability itself had already shipped: the `provider_immutable` hook
was removed from `config/hooks.go` and provider selections are written
explicitly. This item closed with the follow-through: per-entity model
overrides (`model` column on `projection`, `reflection`, `chat_conversation`)
resolving entity → `role_models` → `default_model`, with lazy lens
re-distillation on model drift. Provider remains workspace-level.
