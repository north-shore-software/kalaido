---
title: "Offer to download the recommended Ollama model during workspace setup"
status: "idea"
author: "human"
created: "2026-08-14"
---

## Summary
The setup form now reports whether Ollama is reachable, but reachability is not
the same as working AI. Someone who has installed Ollama and never pulled a
model gets a green tick and a workspace whose AI silently does nothing. Offer a
"Download gemma4" button in the same status box so the gap can be closed without
leaving setup.

## Motivation / Use Case
This is the most likely real-world failure: Ollama installs cleanly and starts
serving with no models at all. The backend's boot preloader retries the default
model every 5s for two minutes and then gives up with a log line
(`kalaidoscope/internal/ollama/handlers.go:23-53`), so nothing surfaces to the
user — generation just fails later, one toast at a time.

Deferred out of the composite creation-flow fix deliberately: it is the largest
single piece of work there, and reachability alone already covers the common
"Ollama isn't installed" case.

## Proposed Concept
- Extend `check_ollama_status` (`app/src-tauri/src/llm.rs`) to return the
  installed model list alongside `reachable`, so the button can be hidden when
  the recommended model is already present. The `/api/tags` call it already
  makes carries that data — nothing extra is fetched.
- Keep the tick itself keyed on reachability only; add a distinct "running, but
  no models installed" state rather than letting the tick imply working AI.
- Add a Rust pull command. `POST /api/ollama/pull` lives on the workspace
  sidecar, which does not exist during setup, so the pull has to go direct to
  `127.0.0.1:11434` from Rust — streaming NDJSON progress back over a Tauri
  channel, with cancellation.
- Reuse `ModelDownloadCard`
  (`app/src/features/settings/components/model-download-card.tsx`), which
  already renders pull progress, percentage and cancel for the Settings path.

## Open Questions
- Does the download stay non-blocking like the reachability warning, or should a
  pull in progress hold the Create button until it finishes?
- Settings' own pull path targets a hardcoded `127.0.0.1:8090`
  (`app/src/api/kalaidoscope/local/models.ts:5`) while sidecars bind an
  ephemeral port, so that page only works against a dev PocketBase. Worth
  folding both onto the Rust path rather than maintaining two.
