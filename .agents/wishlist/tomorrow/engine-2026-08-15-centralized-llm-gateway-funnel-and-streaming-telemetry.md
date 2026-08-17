---
title: "Centralized LLM gateway funnel: concurrency control, role parameters, and live streaming telemetry"
status: "specified"
author: "human"
created: "2026-08-15"
updated: "2026-08-17"
supersedes:
  - ".agents/wishlist/tomorrow/2026-08-15-tokens-received-counter-streaming.md"
  - ".agents/wishlist/tomorrow/2026-08-15-set-temp-to-zero-projection-snapshot-llm-call.md"
---

## Summary
Route all LLM operations through a single centralized execution funnel to enforce serialization on local models (preventing Ollama thrashing/OOM), manage quota/rate limits, apply role-specific parameters (e.g. temperature 0 for deterministic snapshot generation), and report real-time streaming telemetry (tokens received and generation activity) back to the frontend.

## Problem Statement & Context
1. **Uncoordinated Concurrency & Local Model Thrashing**:
   - LLM requests originate from multiple independent flows (interactive chat, background lens distillation, snapshot cascades, color evaluations).
   - When using local LLMs (e.g. Ollama), concurrent model invocations cause extreme GPU/memory contention, thrashing, and crashes.
2. **Scattered Invocation Parameters**:
   - Model parameters are set ad-hoc across endpoints. For example, projection snapshot generation (`RoleSnapshot`) needs `temperature: 0` for consistent and reproducible outputs, but lacks a centralized parameter policy.
3. **Missing Live Stream Telemetry**:
   - During streaming completions, users have no visibility into token throughput, stream activity, or queue status.

## Desired Working End State

### 1. Centralized LLM Gateway / Execution Funnel
- **Single Funnel for All Model Invocations**:
  - Every LLM request—both streaming (`Provider.Stream`) and one-shot completions (`usage.GenerateOnce`) across all roles (`chat`, `refinement`, `colour`, `distill`, `snapshot`)—must execute through the central gateway.
- **Provider-Aware Concurrency & Serialization**:
  - **Local Providers (Ollama)**: Strict concurrency limit of 1 (strictly serial execution) to completely prevent multi-model thrashing and OOM conditions on local hardware.
  - **Remote Providers**: Managed rate-limiting and connection pools per provider.
- **Role-Based Parameter Enforcement**:
  - The funnel enforces canonical hyperparameters per role:
    - `RoleSnapshot` and `RoleDistill`: `temperature: 0` (deterministic synthesis and prompt extraction).
    - `RoleChat` / `RoleRefinement`: Configured conversational defaults.
- **Unified Quota & Usage Accounting**:
  - Centralized pre-execution quota authorization and post-execution token persistence.

### 2. Live Streaming Telemetry & Frontend Stats
- **Streaming Metrics**:
  - As tokens stream from the provider through the funnel, live progress metrics are emitted (e.g. cumulative tokens received, elapsed time, current tokens/second).
- **Frontend Real-Time Display**:
  - Streaming surfaces (such as chat refinement panels and live draft preview bars) receive and display real-time activity indicators and token counts.

## Undecided / Future Refinement (TBD)
- **Interactive Preemption vs. FIFO Queueing**: Whether urgent interactive user actions (e.g. sending a chat message) should preempt or pause background batch tasks (e.g. chained snapshot drainage), or simply queue behind them with a status indicator ("Waiting for local model…").
  - *2026-08-17*: Both mechanisms now exist in `kalaidoscope/internal/llmq` — priority re-ordering of the waiting queue, plus preemption (cancel + owner retry) of in-flight background/idle calls, gated by `Config.PreemptAtOrBelow`. Idle-tier work (colour evals) additionally waits for a quiet period (`IdleAfter`) so it doesn't evict the chat model between turns. Which policy applies per deployment lives in `llmq.ConfigForProvider`; still open is making it user-configurable.

## Acceptance Criteria
- [x] All LLM calls in the backend route through the single centralized gateway funnel.
- [x] Concurrent requests against local Ollama models are serialized to prevent concurrent execution.
- [ ] Snapshot generation (`RoleSnapshot`) and lens distillation (`RoleDistill`) execute with `temperature: 0`.
- [ ] Streaming endpoints emit real-time token count / activity events to the client.
- [ ] Frontend displays live token count / streaming activity during active generations.
