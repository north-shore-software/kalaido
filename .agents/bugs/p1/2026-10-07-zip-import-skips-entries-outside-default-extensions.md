---
title: "Zip import silently skips entries whose extension is not .txt/.md/.docx while the preview calls them importable"
status: "open"
author: "agent"
created: "2026-10-07"
---

## Description
The import preview (Rust sidecar, `app/src-tauri/src/files.rs`) classifies zip entries by sniffing bytes, so any non-binary entry is shown as "Text" and counted as importable. The backend zip parser (`kalaidoscope/internal/ingest/parsers/zip.go`) instead filters entries by extension against the request's `extensions` list, and the app never sends one, so the Go default of `.txt`, `.md`, `.docx` (`kalaidoscope/internal/ingest/batch.go`) applies. Entries with any other extension are dropped without a log line and the ingest record completes as `done` with `ingested = 0`.

## Steps to Reproduce
1. Zip a folder of `.json` text files.
2. Open New Fragment → Import file, pick the zip. Preview shows every file as "Text" and "N importable".
3. Import.

## Expected Behavior
Either the backend accepts whatever the preview called text, or the preview reports those entries as unsupported, or the dialog sends the extension list it computed. The user should not be told a file is importable and then get zero fragments.

## Observed Behavior
Ingest log: `completed record … fragments=0 files=1`. No fragments created, no error surfaced in the UI.
