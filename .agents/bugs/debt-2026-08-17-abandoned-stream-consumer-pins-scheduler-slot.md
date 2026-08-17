---
title: "An abandoned usage.Stream consumer leaks the forwarding goroutine — and now pins an LLM scheduler slot"
status: "open"
author: "agent"
created: "2026-08-17"
---

## Description

`usage.Stream` (`kalaidoscope/internal/usage/stream.go`) forwards provider
events through an unbuffered `wrapped` channel. If a consumer stops reading
from `Completion.Events` without its context being cancelled, the forwarding
goroutine blocks forever on `wrapped <- c`.

This hazard predates the LLM scheduler (it has existed since the wrapper was
introduced), but the scheduler raises its cost: the slot acquired via
`llmq.Acquire` is released in that same goroutine after the stream drains, so
an abandoned consumer now permanently pins one of the (few — 1 on Ollama)
concurrency slots, wedging all further LLM calls, instead of merely leaking a
goroutine.

## Steps to Reproduce

No current caller does this — every existing consumer either drains to channel
close (`GenerateOnce`, `chat.StreamAssistantResponse`) or is unwound by request
context cancellation, which makes the provider close its event channel. The
bug is latent: it needs a future caller that returns early from the event loop
while its context stays alive.

## Expected Behavior

Abandoning a `Completion` should release the scheduler slot and end the
forwarding goroutine — e.g. forward with a `select` on the run context, or give
`Completion` an explicit close/abandon handle.

## Observed Behavior

The forwarding goroutine blocks on the unbuffered send indefinitely;
`release()` is never reached; the slot stays occupied until process restart.
