---
title: "server package tests flake: mapping worker goroutine panics after the test app is torn down"
status: "resolved"
author: "agent"
created: "2026-09-10"
---

## Description
`server.NewWithConfig` calls `mapping.Register`, which starts `go loop()` and `go aggregateLoop()` immediately (`internal/mapping/worker.go:56-59`). Tests in `server/` build an app that way and reset it at cleanup, but the goroutines outlive the test and can touch the closed database, panicking the whole test binary. Seen once in about a dozen runs of `go test ./server/`; the failure names `internal/mapping/worker.go:58` in the goroutine's creation frame.

## Steps to Reproduce
1. `cd kalaidoscope && for i in $(seq 20); do CGO_ENABLED=0 go test -count=1 ./server/; done`
2. Occasionally one run ends in `panic` with a goroutine trace through `worker.go:58` and `FAIL ... server`.

## Expected Behavior
Worker goroutines are started from an `OnServe` hook (or `Register` takes a context tied to the app's lifetime), so a test that never serves never starts them and teardown cannot race them.

## Observed Behavior
Intermittent panic and `FAIL` for the `server` package with no test of its own failing. Seen while testing the schema-migrations change, but the mechanism (goroutines started at construction, not at serve) predates it; the panic did not reproduce in ten further runs on either tree, so it is a race, not a deterministic failure.

## Resolution (2026-09-17)
Workers are now structs owned by `server/runtime.go`, started from an `OnServe` hook and stopped (cancelled and awaited) from `OnTerminate`; `testutil.NewTestServer` triggers terminate in its cleanup. An app that only bootstraps starts no worker goroutine. `go test -count=1 ./server/` passed 10/10 after the change.

## Addendum (2026-09-17, later)
A second goroutine reached the torn-down app the same way: the `llm_queue_status` mirror in `server/queue_status.go` debounced writes with a `time.AfterFunc` whose timer nobody tracked, and nothing unregistered its `llmq.SetOnChange` callback. Once the workers stopped cleanly, `go test -count=2 ./server/` crashed on it every time (stack through `writeQueueStatus` from `time.goFunc`). The mirror is now a small type that binds `OnTerminate`, stops the pending timer, unregisters the callback, and ignores a delivery already in flight. The 2026-09-10 trace did name `mapping/worker.go`, so both sources were real.
