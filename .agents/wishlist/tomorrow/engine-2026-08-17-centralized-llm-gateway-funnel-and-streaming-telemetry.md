---
title: "LLM gateway: remaining functionality"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
---

## Summary

All LLM calls now run through a central scheduler (concurrency limiting, rate
limiting, priority queueing with preemption, idle-gated background work, and a
live queue/throughput line in the utility bar). This doc covers what that
gateway still needs, stated as product requirements.

## Requirements

### 1. Role-appropriate generation parameters
Output the user treats as a stable artifact must be reproducible; conversation
should stay natural.
- Snapshot generation and lens distillation run deterministically
  (temperature 0): regenerating from the same lens and context yields the same
  text.
- Chat and refinement use conversational defaults.
- Parameters are a per-role policy in one place, not set ad-hoc per endpoint.

### 2. Telemetry at the point of work
The utility bar shows global activity; the surface the user is actually
watching should show its own.
- While a chat / refinement response or a draft preview streams, that surface
  shows live activity (tokens received and/or rate) for *its* generation.
- While a request is queued behind other work, the surface says so ("waiting
  for local model…") instead of appearing hung.

### 3. User-configurable scheduling policy
The right trade-offs are machine- and taste-dependent, especially on local
Ollama; today they are compile-time constants.
- A user can adjust, per workspace: whether interactive work preempts an
  in-flight background generation (vs. waiting for it), the quiet period
  before opportunistic background work (colour evals) starts, and the
  concurrency / request-rate caps for their provider.
- Sensible defaults per provider remain; configuration is optional tuning.

### 4. Background failure visibility
Backgrounded work means errors no longer surface on a request; durable
failures (bad key, exhausted quota) are recorded but invisible.
- When background generation is failing for a reason the user must act on,
  the UI says so — visibly enough to be found, quietly enough not to
  interrupt — and points at what to fix.
- Transient failures self-heal silently via retry and are not surfaced.

## Acceptance Criteria
- [ ] Regenerating a snapshot from an unchanged lens and context produces identical output.
- [ ] Chat, refinement, and draft-preview surfaces show live streaming activity for their own generation, and an explicit queued/waiting state.
- [ ] Scheduling policy (preemption, idle quiet period, concurrency/rate caps) is adjustable by the user per workspace.
- [ ] A stuck provider (auth/quota) is visible in the UI without opening logs, with a pointer to the fix.
