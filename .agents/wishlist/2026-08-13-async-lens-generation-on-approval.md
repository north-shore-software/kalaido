---
title: "Asynchronous / Background Lens Generation on Candidate Approval"
status: "idea"
author: "human"
created: "2026-08-13"
---

## Summary
Offload lens generation to a background process when clicking "Approve candidate", preventing synchronous UI blocking during LLM execution—especially critical for local models like Ollama.

## Motivation / Use Case
Approving a projection candidate currently triggers synchronous lens generation on the backend. When running local LLMs (e.g., via Ollama), this step can take many seconds or minutes, hanging the HTTP request and making the application feel unresponsive. Moving lens generation to background execution allows the UI to respond instantly upon approval while lens distillation completes asynchronously.

## Proposed Concept
1. **Asynchronous Approval Workflow**:
   - Clicking "Approve candidate" immediately updates the candidate state in the database and returns a successful response to the UI.
   - The backend enqueues a background job to perform lens distillation/generation asynchronously.
2. **UI Realtime Updates**:
   - The UI immediately navigates or updates state, displaying a subtle background status (e.g. "Generating lens in background…") using realtime events/subscriptions.
   - Once background processing finishes, the UI updates smoothly without blocking user navigation.
3. **Queue & Resilience**:
   - Use an internal background task worker to serialize or queue LLM lens generation tasks, preventing local Ollama model concurrency overload.

## Open Questions
- How should downstream dependent projections/reflections treat a newly approved snapshot while its background lens is still generating?
- How should background job errors or timeouts (e.g., Ollama out of memory or model crash) be reported back to the user?
- Should users be able to manually retry or cancel a pending background lens generation task?
