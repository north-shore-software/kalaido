---
title: "Global OS-Level Hotkey for Quick Note Addition"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Register a configurable OS-level global keyboard shortcut (e.g. `Cmd+Shift+K` / `Option+Space`) that summons the "Add Note / Add Fragment" capture dialog from anywhere in the desktop operating system, even when Kalaido is running in the background.

## Motivation / Use Case
Capturing fragments and quick notes must be completely frictionless. When a user is working in another application (code editor, browser, terminal) and wants to record a quick thought or work update into Kalaido, switching windows introduces context switching fatigue. A global system shortcut allows instant, zero-friction note capture.

## Proposed Concept
1. **Desktop Shell Shortcut Registration**:
   - Register a global hotkey via the desktop wrapper (e.g., Tauri / Electron global shortcut API).
2. **Quick Capture Window / Modal**:
   - Pressing the hotkey brings Kalaido to the foreground (or opens a lightweight floating quick-capture window) with auto-focus on the note input field.
3. **Seamless Ingest & Dismissal**:
   - Submitting the note immediately ingests the fragment into the active Kalaidoscope and automatically dismisses or hides the quick-capture window back to the background.

## Open Questions
- Should the global hotkey trigger the main app window or a dedicated, minimal floating HUD/popup window?
- What default key combination should be selected to avoid OS shortcut collisions across macOS, Windows, and Linux?
- How should OS permission prompts (e.g. macOS Accessibility or Input Monitoring) be communicated to the user during setup?
