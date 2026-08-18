---
title: "Ollama boot preload hardcodes gemma4, ignoring workspace config"
status: "open"
author: "agent"
created: "2026-08-18"
---

## Description
`preloadDefaultModel` in `kalaidoscope/internal/ollama/handlers.go` always warms
the package-level `const defaultModel = "gemma4"` (`ollama.go`) at boot,
without consulting the workspace's resolved model configuration
(`default_model` / `role_models`, and now per-entity overrides). The frontend's
`RECOMMENDED_MODEL = "gemma4"` (`app/src/api/kalaidoscope/llm-config.ts`)
duplicates the same value.

## Steps to Reproduce
1. Configure an Ollama workspace with a `default_model` other than `gemma4`.
2. Restart the sidecar.
3. Observe the preload pulls/warms `gemma4` rather than the configured model.

## Expected Behavior
The boot preload warms the model(s) the workspace will actually use, resolved
from config after `LoadAtBoot`.

## Observed Behavior
`gemma4` is always preloaded; the configured model is cold until its first
real call, and an unused model may be pulled.
